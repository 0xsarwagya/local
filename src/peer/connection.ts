import type { Ghost } from "@0xsarwagya/ghost";
import { verifyGhostProof } from "@0xsarwagya/ghost/server";

import type { AnswerBootstrap, OfferBootstrap } from "./bootstrap";
import { SessionChallengeStore } from "./challenge-store";
import {
  CHAT_PROTOCOL,
  LIMITS,
  SUPPORTED_CHAT_VERSIONS,
  newFrameId,
  validateIncomingRaw,
  type Frame,
  type HelloBody,
  type MessageBody,
} from "../chat/frame";
import {
  openConversation,
  pinOrCheckPeerKey,
  type ChatMessage,
  type ConversationState,
} from "../conversations/store";
import { registerConversation } from "../conversations/list";
import type { Slot } from "@0xsarwagya/durable-local";

const AUDIENCE = "local-chat";
const ACTION = "peer-hello";

export type ConnectionState =
  | "verifying"
  | "connected"
  | "interrupted"
  | "failed"
  | "closed";

export interface ConnectionEvents {
  onState: (state: ConnectionState, detail?: string) => void;
  onMessage: (message: ChatMessage) => void;
  onPeerPinned: (peer: {
    ghostId: string;
    displayName: string;
    publicKey: string;
  }) => void;
}

/**
 * Manages a live peer connection from the moment the data channel opens
 * through Ghost verification, chat frame validation, message
 * persistence, and teardown.
 *
 * Constructed by both offer and answer flows once each side has its
 * (data channel, challenge store, own Ghost, peer identity claim).
 */
export interface ConnectionArgs {
  role: "offerer" | "answerer";
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  challengeStore: SessionChallengeStore;
  ghost: Ghost;
  /**
   * The peer's claimed identity at ceremony start. Verified via Ghost
   * proof over the data channel — this is not trusted until then.
   */
  peerIdentity: {
    ghostId: string;
    publicKey: string;
    displayName: string;
  };
  /**
   * The challenge this side must ask the peer to sign, delivered over
   * the data channel in the peer's hello frame. Offerer received it
   * inside the answer bootstrap; answerer already verified its own
   * proof-of-A at handshake time and sends a hello to complete the
   * mutual verification.
   */
  awaitingProofChallenge?: {
    nonce: string;
  };
  /** Challenge we need to sign into our own hello, provided by the peer. */
  challengeToSign: Parameters<Ghost["sign"]>[0];
  events: ConnectionEvents;
}

export class Connection {
  private readonly seenIds = new Set<string>();
  private seenIdsOrder: string[] = [];
  private readonly sentAckable = new Set<string>();
  private sentAckableOrder: string[] = [];
  private rlTokens: number = LIMITS.RL_BUCKET_MAX;
  private rlLastRefill = performance.now();
  private rlStrikes: number[] = [];
  private state: ConnectionState = "verifying";
  private slot: Slot<ConversationState> | null = null;
  private closed = false;
  private helloSent = false;
  private peerHelloVerified = false;
  private sendBlocked = false;
  private readonly pendingSends: string[] = [];

  constructor(private readonly args: ConnectionArgs) {
    args.channel.binaryType = "arraybuffer";
    args.channel.bufferedAmountLowThreshold = LIMITS.BACKPRESSURE_LOW;
    args.channel.addEventListener("message", this.handleMessage);
    args.channel.addEventListener("close", this.handleChannelClose);
    args.channel.addEventListener("error", this.handleChannelError);
    args.channel.addEventListener("bufferedamountlow", this.handleDrain);
    args.pc.addEventListener("connectionstatechange", this.handlePcState);
  }

  async start(): Promise<void> {
    // Both sides send a hello immediately with their proof over the
    // peer's challenge. Offerer signs `challengeToSign` (from B's
    // answer bootstrap), answerer signs it too (from A's offer).
    try {
      const proof = await this.args.ghost.sign(this.args.challengeToSign);
      const hello: Frame<HelloBody> = {
        protocol: CHAT_PROTOCOL,
        type: "hello",
        id: newFrameId(),
        sentAt: Date.now(),
        body: {
          supportedVersions: [...SUPPORTED_CHAT_VERSIONS],
          selectedVersion: 1,
          proof,
        },
      };
      this.enqueue(JSON.stringify(hello));
      this.helloSent = true;
    } catch (err) {
      this.transition("failed", `hello signing failed: ${(err as Error).message}`);
    }
  }

  send(text: string): { id: string } | { error: string } {
    if (this.state !== "connected") {
      return { error: "not connected" };
    }
    const encoded = new TextEncoder().encode(text);
    if (encoded.byteLength === 0 || encoded.byteLength > LIMITS.TEXT_BODY_MAX) {
      return { error: "text out of bounds" };
    }
    const frame: Frame<MessageBody> = {
      protocol: CHAT_PROTOCOL,
      type: "message",
      id: newFrameId(),
      sentAt: Date.now(),
      body: { kind: "text", text },
    };
    this.rememberSent(frame.id);
    this.enqueue(JSON.stringify(frame));
    void this.persistOwnMessage(frame);
    return { id: frame.id };
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.args.channel.close();
    } catch {
      /* ignore */
    }
    try {
      this.args.pc.close();
    } catch {
      /* ignore */
    }
    this.args.challengeStore.clear();
    this.transition("closed", reason);
  }

  currentState(): ConnectionState {
    return this.state;
  }

  private enqueue(raw: string): void {
    if (this.args.channel.readyState !== "open") return;
    if (
      this.sendBlocked ||
      this.args.channel.bufferedAmount > LIMITS.BACKPRESSURE_HIGH
    ) {
      this.sendBlocked = true;
      this.pendingSends.push(raw);
      return;
    }
    try {
      this.args.channel.send(raw);
    } catch {
      this.transition("failed", "data channel send threw");
    }
  }

  private handleDrain = (): void => {
    if (!this.sendBlocked) return;
    while (
      this.pendingSends.length > 0 &&
      this.args.channel.bufferedAmount < LIMITS.BACKPRESSURE_HIGH
    ) {
      const next = this.pendingSends.shift();
      if (next === undefined) break;
      try {
        this.args.channel.send(next);
      } catch {
        this.transition("failed", "data channel send threw during drain");
        return;
      }
    }
    if (this.pendingSends.length === 0) this.sendBlocked = false;
  };

  private handleMessage = async (ev: MessageEvent): Promise<void> => {
    if (this.closed) return;
    if (!this.rateLimit()) return;

    const raw = typeof ev.data === "string" ? ev.data : "";
    if (raw === "") {
      // Binary frames are not part of v1. Drop.
      return;
    }
    const result = validateIncomingRaw(raw, this.seenIds);
    if (!result.ok) {
      this.strike();
      return;
    }
    this.rememberSeen(result.frame.id);

    switch (result.frame.type) {
      case "hello": {
        if (this.peerHelloVerified) {
          this.strike();
          return;
        }
        await this.handleHello(result.frame as Frame<HelloBody>);
        return;
      }
      case "message": {
        if (this.state !== "connected") {
          this.strike();
          return;
        }
        await this.handleTextMessage(result.frame as Frame<MessageBody>);
        return;
      }
      case "ack": {
        // v1 does not surface ack state to the UI beyond a "delivered"
        // indicator; that's future work. Accept but do nothing.
        if (this.state !== "connected") this.strike();
        return;
      }
    }
  };

  private async handleHello(frame: Frame<HelloBody>): Promise<void> {
    const versions = frame.body.supportedVersions;
    if (!versions.includes(1) || frame.body.selectedVersion !== 1) {
      this.transition("failed", "no compatible chat protocol version");
      return;
    }

    const verification = await verifyGhostProof(frame.body.proof, {
      expectedAudience: AUDIENCE,
      expectedAction: ACTION,
      expectedGhostId: this.args.peerIdentity.ghostId,
      challengeStore: this.args.challengeStore,
    });
    if (!verification.ok) {
      this.transition("failed", `peer hello proof failed: ${verification.code}`);
      return;
    }
    if (verification.publicKey !== this.args.peerIdentity.publicKey) {
      this.transition("failed", "peer hello public key mismatch");
      return;
    }

    // Bind the conversation slot now that identity is verified.
    try {
      const slot = await openConversation(this.args.peerIdentity);
      // Reconnection path: refuse a mismatched publicKey (which
      // pinOrCheckPeerKey throws on).
      await pinOrCheckPeerKey(slot, this.args.peerIdentity);
      await registerConversation(this.args.peerIdentity.ghostId);
      this.slot = slot;
      this.peerHelloVerified = true;
      this.args.events.onPeerPinned(this.args.peerIdentity);
      this.transition("connected");
    } catch (err) {
      this.transition("failed", (err as Error).message);
    }
  }

  private async handleTextMessage(frame: Frame<MessageBody>): Promise<void> {
    if (this.slot === null) {
      this.strike();
      return;
    }
    const message: ChatMessage = {
      id: frame.id,
      senderGhostId: this.args.peerIdentity.ghostId,
      text: frame.body.text,
      sentAt: frame.sentAt,
      receivedAt: Date.now(),
      committed: true,
    };
    try {
      await this.slot.update((current) => ({
        ...current,
        conversation: [...current.conversation, message],
      }));
      this.args.events.onMessage(message);
    } catch (err) {
      // Persistence failed: surface the failure honestly. Do not
      // silently show it as durable.
      this.args.events.onState(
        "failed",
        `Could not persist incoming message: ${(err as Error).message}`,
      );
    }
  }

  private async persistOwnMessage(frame: Frame<MessageBody>): Promise<void> {
    if (this.slot === null) return;
    const message: ChatMessage = {
      id: frame.id,
      senderGhostId: this.args.ghost.id,
      text: frame.body.text,
      sentAt: frame.sentAt,
      receivedAt: frame.sentAt,
      committed: true,
    };
    try {
      await this.slot.update((current) => ({
        ...current,
        conversation: [...current.conversation, message],
      }));
      this.args.events.onMessage(message);
    } catch {
      /* UI-side already showed the message optimistically; the
         failure is handled by the persistence pipeline elsewhere. */
    }
  }

  private handleChannelClose = (): void => {
    if (this.state === "closed" || this.state === "failed") return;
    this.transition("closed");
  };

  private handleChannelError = (): void => {
    if (this.state === "closed" || this.state === "failed") return;
    this.transition("failed", "data channel error");
  };

  private handlePcState = (): void => {
    switch (this.args.pc.connectionState) {
      case "connected":
        // Do not preempt verification progress; helloVerified sets
        // "connected" from verifying.
        return;
      case "disconnected":
        if (this.state === "connected") this.transition("interrupted");
        return;
      case "failed":
        this.transition("failed", "peer connection failed");
        return;
      case "closed":
        if (this.state !== "failed") this.transition("closed");
        return;
      default:
        return;
    }
  };

  private transition(next: ConnectionState, detail?: string): void {
    if (this.state === next) return;
    this.state = next;
    this.args.events.onState(next, detail);
  }

  private rateLimit(): boolean {
    const now = performance.now();
    const refill = ((now - this.rlLastRefill) / 1000) * LIMITS.RL_REFILL_PER_SEC;
    this.rlTokens = Math.min(LIMITS.RL_BUCKET_MAX, this.rlTokens + refill);
    this.rlLastRefill = now;
    if (this.rlTokens < 1) {
      this.strike();
      return false;
    }
    this.rlTokens -= 1;
    return true;
  }

  private strike(): void {
    const now = performance.now();
    this.rlStrikes = this.rlStrikes.filter(
      (t) => now - t <= LIMITS.RL_STRIKE_WINDOW_MS,
    );
    this.rlStrikes.push(now);
    if (this.rlStrikes.length >= LIMITS.RL_STRIKE_TEARDOWN) {
      this.transition("failed", "peer frame-rate abuse");
      this.close("frame-rate abuse");
    }
  }

  private rememberSeen(id: string): void {
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    this.seenIdsOrder.push(id);
    if (this.seenIdsOrder.length > LIMITS.SEEN_LRU) {
      const drop = this.seenIdsOrder.shift();
      if (drop !== undefined) this.seenIds.delete(drop);
    }
  }

  private rememberSent(id: string): void {
    if (this.sentAckable.has(id)) return;
    this.sentAckable.add(id);
    this.sentAckableOrder.push(id);
    if (this.sentAckableOrder.length > LIMITS.SENT_LRU) {
      const drop = this.sentAckableOrder.shift();
      if (drop !== undefined) this.sentAckable.delete(drop);
    }
  }
}
