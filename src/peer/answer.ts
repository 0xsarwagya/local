import { createHandoff, type HandoffOffer } from "@0xsarwagya/handoff";
import { deriveGhostId, type Ghost } from "@0xsarwagya/ghost";
import { createChallenge, verifyGhostProof } from "@0xsarwagya/ghost/server";

import type { AnswerBootstrap, OfferBootstrap } from "./bootstrap";
import { PROTOCOL, VERSION } from "./bootstrap";
import { SessionChallengeStore } from "./challenge-store";
import { RTC_CONFIG, waitForIceGatheringComplete } from "./rtc";

const AUDIENCE = "local-chat";
const ACTION = "peer-hello";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface AnswerResult {
  pc: RTCPeerConnection;
  channel: Promise<RTCDataChannel>;
  challengeStore: SessionChallengeStore;
  bootstrap: AnswerBootstrap;
  handoff: HandoffOffer;
  gathering: "complete" | "timeout";
  /** The offerer's identity — B never trusts it beyond this, but pins it here. */
  offererIdentity: OfferBootstrap["offerer"];
}

/**
 * Peer B — apply the offer bootstrap, produce an answer bootstrap.
 * The returned `channel` promise resolves when B's ondatachannel fires
 * (i.e. after A applies the answer). B never calls createDataChannel.
 */
export async function createAnswer(input: {
  ghost: Ghost;
  displayName: string;
  offerBootstrap: OfferBootstrap;
  receiveUrl: string;
}): Promise<AnswerResult> {
  // v1 rule: only accept first-contact peers whose ghostId is derivable
  // from the presented publicKey. Recovered/rotated identities are
  // legitimate but require prior pinning, which v1 lacks.
  const derived = await deriveGhostId(
    base64UrlToBytes(input.offerBootstrap.offerer.publicKey),
  );
  if (derived !== input.offerBootstrap.offerer.ghostId) {
    throw new Error(
      "This invitation is from a recovered or rotated identity. Local v1 " +
        "only accepts first-contact peers whose ghost identity is derived " +
        "from their key material. Ask them to send a fresh invitation from " +
        "their original key, or wait for Local's recovered-identity support.",
    );
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Wait for A's data channel to arrive. Wrap in a promise so callers
  // can await it after handing off the answer.
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (event) => resolve(event.channel);
  });

  await pc.setRemoteDescription({
    type: input.offerBootstrap.sdp.type,
    sdp: input.offerBootstrap.sdp.sdp,
  });

  await pc.createAnswer();
  await pc.setLocalDescription();

  const gathering = await waitForIceGatheringComplete(pc, 5_000);

  const localDesc = pc.localDescription;
  if (!localDesc || !localDesc.sdp || localDesc.type !== "answer") {
    throw new Error("no local answer produced");
  }

  // B signs the challenge A pre-issued in the offer bootstrap. This
  // travels back to A inside the answer bootstrap so A can verify B
  // before applying setRemoteDescription.
  const answererProof = await input.ghost.sign(
    input.offerBootstrap.challengeForAnswerer,
  );

  // B issues a challenge for A to sign after the data channel opens.
  const challengeStore = new SessionChallengeStore();
  const challengeForOfferer = createChallenge({
    audience: AUDIENCE,
    action: ACTION,
    ttlMs: CHALLENGE_TTL_MS,
  });
  challengeStore.issue(challengeForOfferer);

  const bootstrap: AnswerBootstrap = {
    protocol: PROTOCOL,
    version: VERSION,
    role: "answer",
    answerer: {
      ghostId: input.ghost.id,
      publicKey: input.ghost.publicKey,
      displayName: input.displayName.slice(0, 64),
    },
    sdp: { type: "answer", sdp: localDesc.sdp },
    answererProof,
    challengeForOfferer,
    createdAt: Date.now(),
  };

  const handoffApi = createHandoff({ receiveUrl: input.receiveUrl });
  const handoff = await handoffApi.create(
    bootstrap as unknown as import("@0xsarwagya/handoff").HandoffState,
    { limit: 16_384 },
  );

  return {
    pc,
    channel,
    challengeStore,
    bootstrap,
    handoff,
    gathering,
    offererIdentity: input.offerBootstrap.offerer,
  };
}

/**
 * A → consume B's answer bootstrap.
 * Verifies B's proof against A's challenge, then applies setRemoteDescription.
 * On success, the data channel A created will fire onopen shortly after.
 */
export async function applyAnswerBootstrap(input: {
  pc: RTCPeerConnection;
  challengeStore: SessionChallengeStore;
  answerBootstrap: AnswerBootstrap;
}): Promise<void> {
  const { pc, challengeStore, answerBootstrap } = input;

  // v1 first-contact rule (same as offerer/answerer on the other side).
  const derived = await deriveGhostId(
    base64UrlToBytes(answerBootstrap.answerer.publicKey),
  );
  if (derived !== answerBootstrap.answerer.ghostId) {
    throw new Error(
      "The reply is from a recovered or rotated identity. Local v1 only " +
        "supports first-contact peers whose ghost identity is derived from " +
        "their key.",
    );
  }

  const verification = await verifyGhostProof(answerBootstrap.answererProof, {
    expectedAudience: AUDIENCE,
    expectedAction: ACTION,
    expectedGhostId: answerBootstrap.answerer.ghostId,
    challengeStore,
  });

  if (!verification.ok) {
    throw new Error(
      `Peer identity verification failed: ${verification.code} — ${verification.message}`,
    );
  }
  if (verification.publicKey !== answerBootstrap.answerer.publicKey) {
    throw new Error("Peer proof carried a different public key than the bootstrap claim.");
  }

  await pc.setRemoteDescription({
    type: answerBootstrap.sdp.type,
    sdp: answerBootstrap.sdp.sdp,
  });
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
