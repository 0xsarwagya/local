import { useCallback, useEffect, useRef, useState } from "react";

import { createOffer } from "../peer/offer";
import { applyAnswerBootstrap, createAnswer } from "../peer/answer";
import { assertAnswerBootstrap, type OfferBootstrap } from "../peer/bootstrap";
import { waitForChannelOpen } from "../peer/rtc";
import { Connection, type ConnectionState } from "../peer/connection";
import type { ChatMessage } from "../conversations/store";
import { getIdentity, sasFingerprint } from "../identity/store";
import { InviteView } from "./InviteView";
import { JoinView } from "./JoinView";
import { ChatView } from "./ChatView";
import { createHandoff } from "@0xsarwagya/handoff";
import type { Ghost } from "@0xsarwagya/ghost";

const RECEIVE_URL = getReceiveUrl();

type Props =
  | { role: "offerer"; onLeave: () => void }
  | { role: "answerer"; bootstrap: OfferBootstrap; onLeave: () => void };

type Phase =
  | { kind: "loading" }
  | { kind: "inviting"; url: string; artifact: string; qrFriendly: boolean }
  | { kind: "awaiting-answer"; url: string; artifact: string; qrFriendly: boolean; peerName: string; peerSas: string }
  | { kind: "reviewing"; peerName: string; peerSas: string; peerGhostId: string }
  | { kind: "answering"; url: string; artifact: string; qrFriendly: boolean; peerName: string; peerSas: string }
  | { kind: "connecting" }
  | { kind: "verifying"; peerName: string; peerSas: string }
  | { kind: "connected"; peerName: string; peerSas: string; peerGhostId: string }
  | { kind: "interrupted" }
  | { kind: "failed"; message: string }
  | { kind: "closed" };

export function Session(props: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ownGhost, setOwnGhost] = useState<Ghost | null>(null);
  const connectionRef = useRef<Connection | null>(null);

  // Run the ceremony exactly once per mount.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const identity = await getIdentity();
        setOwnGhost(identity.ghost);
        if (props.role === "offerer") {
          await runOfferer(identity.ghost, setPhase, connectionRef, setMessages);
        } else {
          await runAnswerer(
            identity.ghost,
            props.bootstrap,
            setPhase,
            connectionRef,
            setMessages,
          );
        }
      } catch (err) {
        setPhase({ kind: "failed", message: describe(err) });
      }
    })();
    return () => {
      connectionRef.current?.close("session unmounted");
    };
  }, [props]);

  const onSend = useCallback((text: string) => {
    const conn = connectionRef.current;
    if (conn === null) return { error: "not connected" };
    return conn.send(text);
  }, []);

  if (phase.kind === "loading") {
    return <Placeholder label="Preparing this browser…" />;
  }
  if (phase.kind === "inviting" || phase.kind === "awaiting-answer") {
    return (
      <InviteView
        phase={phase}
        onCancel={() => {
          connectionRef.current?.close("cancelled");
          props.onLeave();
        }}
      />
    );
  }
  if (phase.kind === "reviewing") {
    return (
      <ConfirmationView
        peerName={phase.peerName}
        peerSas={phase.peerSas}
        peerGhostId={phase.peerGhostId}
        onDecline={() => {
          connectionRef.current?.close("declined");
          props.onLeave();
        }}
        onAccept={async () => {
          if (props.role !== "answerer") return;
          try {
            const identity = await getIdentity();
            await runAnswerCeremony(
              identity.ghost,
              props.bootstrap,
              setPhase,
              connectionRef,
              setMessages,
            );
          } catch (err) {
            setPhase({ kind: "failed", message: describe(err) });
          }
        }}
      />
    );
  }
  if (phase.kind === "answering") {
    return (
      <JoinView
        phase={phase}
        onCancel={() => {
          connectionRef.current?.close("cancelled");
          props.onLeave();
        }}
      />
    );
  }
  if (phase.kind === "connecting") {
    return <Placeholder label="Connecting…" />;
  }
  if (phase.kind === "verifying") {
    return (
      <Placeholder
        label={`Verifying identity — ${phase.peerName}`}
        detail={`Fingerprint  ${phase.peerSas}`}
      />
    );
  }
  if (phase.kind === "connected") {
    return (
      <ChatView
        peerName={phase.peerName}
        peerSas={phase.peerSas}
        peerGhostId={phase.peerGhostId}
        ownGhostId={ownGhost?.id ?? ""}
        messages={messages}
        onSend={onSend}
        onLeave={() => {
          connectionRef.current?.close("left");
          props.onLeave();
        }}
      />
    );
  }
  if (phase.kind === "interrupted") {
    return (
      <Placeholder
        label="Connection paused"
        detail="Waiting for it to recover. If it stays paused, try reconnecting."
      />
    );
  }
  if (phase.kind === "failed") {
    return (
      <FailedView message={phase.message} onLeave={props.onLeave} />
    );
  }
  return (
    <Placeholder
      label="Disconnected"
      detail="This session has ended. Your history is still here."
    />
  );
}

async function runOfferer(
  ghost: Ghost,
  setPhase: (p: Phase) => void,
  connectionRef: React.MutableRefObject<Connection | null>,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  const result = await createOffer({
    ghost,
    displayName: displayNameFor(ghost),
    receiveUrl: RECEIVE_URL,
  });

  setPhase({
    kind: "inviting",
    url: result.handoff.url,
    artifact: result.handoff.artifact,
    qrFriendly: result.handoff.qrFriendly,
  });

  // The offerer must wait for the answer artifact. In v1 the user
  // pastes it into the invite view; InviteView surfaces the paste
  // affordance and calls back here via a global function on window.
  // (Kept off React state to keep the ceremony's async chain readable.)
  const answerRaw = await promptForAnswerFromUi();

  const handoffApi = createHandoff({ receiveUrl: RECEIVE_URL });
  const answerBootstrap = await handoffApi.receive(answerRaw);
  assertAnswerBootstrap(answerBootstrap);

  setPhase({ kind: "connecting" });

  await applyAnswerBootstrap({
    pc: result.pc,
    challengeStore: result.challengeStore,
    answerBootstrap,
  });

  await waitForChannelOpen(result.channel);

  setPhase({
    kind: "verifying",
    peerName: answerBootstrap.answerer.displayName,
    peerSas: sasFingerprint(answerBootstrap.answerer.ghostId),
  });

  const connection = new Connection({
    role: "offerer",
    pc: result.pc,
    channel: result.channel,
    challengeStore: result.challengeStore,
    ghost,
    peerIdentity: answerBootstrap.answerer,
    challengeToSign: answerBootstrap.challengeForOfferer,
    events: {
      onState: (state, detail) =>
        setPhase(mapState(state, answerBootstrap.answerer, detail)),
      onMessage: (m) => setMessages((all) => [...all, m]),
      onPeerPinned: () => {
        /* handled in state transitions */
      },
    },
  });
  connectionRef.current = connection;
  await connection.start();
}

async function runAnswerer(
  ghost: Ghost,
  bootstrap: OfferBootstrap,
  setPhase: (p: Phase) => void,
  _connectionRef: React.MutableRefObject<Connection | null>,
  _setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  // First show a confirmation card. The user must explicitly accept
  // — no auto-connect on link open.
  setPhase({
    kind: "reviewing",
    peerName: bootstrap.offerer.displayName,
    peerSas: sasFingerprint(bootstrap.offerer.ghostId),
    peerGhostId: bootstrap.offerer.ghostId,
  });
}

async function runAnswerCeremony(
  ghost: Ghost,
  bootstrap: OfferBootstrap,
  setPhase: (p: Phase) => void,
  connectionRef: React.MutableRefObject<Connection | null>,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
) {
  const result = await createAnswer({
    ghost,
    displayName: displayNameFor(ghost),
    offerBootstrap: bootstrap,
    receiveUrl: RECEIVE_URL,
  });

  setPhase({
    kind: "answering",
    url: result.handoff.url,
    artifact: result.handoff.artifact,
    qrFriendly: result.handoff.qrFriendly,
    peerName: bootstrap.offerer.displayName,
    peerSas: sasFingerprint(bootstrap.offerer.ghostId),
  });

  const channel = await result.channel;
  await waitForChannelOpen(channel);

  setPhase({
    kind: "verifying",
    peerName: bootstrap.offerer.displayName,
    peerSas: sasFingerprint(bootstrap.offerer.ghostId),
  });

  const connection = new Connection({
    role: "answerer",
    pc: result.pc,
    channel,
    challengeStore: result.challengeStore,
    ghost,
    peerIdentity: bootstrap.offerer,
    challengeToSign: bootstrap.challengeForAnswerer,
    events: {
      onState: (state, detail) =>
        setPhase(mapState(state, bootstrap.offerer, detail)),
      onMessage: (m) => setMessages((all) => [...all, m]),
      onPeerPinned: () => {
        /* handled in state transitions */
      },
    },
  });
  connectionRef.current = connection;
  await connection.start();
}

function mapState(
  state: ConnectionState,
  peer: { ghostId: string; displayName: string },
  detail?: string,
): Phase {
  const peerSas = sasFingerprint(peer.ghostId);
  switch (state) {
    case "verifying":
      return { kind: "verifying", peerName: peer.displayName, peerSas };
    case "connected":
      return {
        kind: "connected",
        peerName: peer.displayName,
        peerSas,
        peerGhostId: peer.ghostId,
      };
    case "interrupted":
      return { kind: "interrupted" };
    case "failed":
      return { kind: "failed", message: detail ?? "connection failed" };
    case "closed":
      return { kind: "closed" };
  }
}

function displayNameFor(ghost: Ghost): string {
  const short = ghost.id.replace(/^ghost_\d+_/, "").slice(0, 6);
  return `guest ${short}`;
}

function getReceiveUrl(): string {
  if (typeof window === "undefined") return "http://localhost:5173/";
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The offerer pastes the answer artifact into a form field managed by
// InviteView. That component resolves this global-scoped promise so
// the ceremony's async chain can stay readable.
let answerResolver: ((raw: string) => void) | null = null;
declare global {
  interface Window {
    __localSubmitAnswer?: (raw: string) => void;
  }
}
if (typeof window !== "undefined") {
  window.__localSubmitAnswer = (raw) => {
    if (answerResolver !== null) {
      const r = answerResolver;
      answerResolver = null;
      r(raw);
    }
  };
}
function promptForAnswerFromUi(): Promise<string> {
  return new Promise((resolve) => {
    answerResolver = resolve;
  });
}

function Placeholder({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-24">
      <span className="label">Local</span>
      <p className="font-serif text-[24px] italic">{label}</p>
      {detail ? <p className="font-mono text-[12px] text-stone">{detail}</p> : null}
    </div>
  );
}

function ConfirmationView({
  peerName,
  peerSas,
  peerGhostId,
  onAccept,
  onDecline,
}: {
  peerName: string;
  peerSas: string;
  peerGhostId: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-8 py-16">
      <span className="label">Someone wants to connect</span>
      <div>
        <p className="font-serif text-[28px] italic">{peerName}</p>
        <p className="mt-2 font-mono text-[11px] text-stone">
          Fingerprint · <span className="text-ink">{peerSas}</span>
        </p>
        <p className="mt-1 font-mono text-[10px] text-stone/60">{peerGhostId}</p>
      </div>
      <p className="max-w-md text-[13px] leading-relaxed text-ink/75">
        Before accepting: ask them out-of-band (over a call, or by looking at
        their screen) that their fingerprint on their side matches the one
        above. Local cannot prove who they are on first contact for you.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onAccept}
          className="border border-rust bg-rust/10 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-rust hover:bg-rust/20"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="border border-ink/20 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink hover:border-rust hover:text-rust"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function FailedView({ message, onLeave }: { message: string; onLeave: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 py-16">
      <span className="label">Connection failed</span>
      <p className="font-serif text-[22px] italic">
        Something didn&rsquo;t work.
      </p>
      <p className="max-w-md font-mono text-[12px] text-stone">{message}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-ink/75">
        About 15–20% of network pairs (symmetric NAT, corporate firewalls,
        some cellular carriers) cannot connect peer-to-peer without a relay
        server. Local v1 does not run one. Try from a different network —
        a home Wi-Fi or a mobile hotspot often works when a restrictive one
        does not.
      </p>
      <div>
        <button
          type="button"
          onClick={onLeave}
          className="border border-ink/20 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink hover:border-rust hover:text-rust"
        >
          Back
        </button>
      </div>
    </div>
  );
}
