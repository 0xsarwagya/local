import { useCeremony, type CeremonyRole } from "../hooks/useCeremony";
import { useIdentity } from "../hooks/useIdentity";
import { ChatView } from "./ChatView";
import { InviteView } from "./InviteView";
import { JoinView } from "./JoinView";
import { PeerConfirmation } from "./PeerConfirmation";
import { StatusView } from "./StatusView";
import { UnsupportedView } from "./UnsupportedView";
import type { OfferBootstrap } from "../peer/bootstrap";

type Props =
  | { role: "offerer"; onLeave: () => void }
  | { role: "answerer"; bootstrap: OfferBootstrap; onLeave: () => void };

/**
 * Session is pure view routing. The state machine, connection
 * lifecycle, and message stream all live in useCeremony().
 */
export function Session(props: Props) {
  const identityState = useIdentity();
  const role: CeremonyRole | null =
    identityState.status === "ready"
      ? props.role === "offerer"
        ? { role: "offerer", ghost: identityState.identity.ghost }
        : {
            role: "answerer",
            ghost: identityState.identity.ghost,
            bootstrap: props.bootstrap,
          }
      : null;
  const ceremony = useCeremony(role);

  if (identityState.status === "loading") {
    return <StatusView label="Preparing this browser…" />;
  }
  if (identityState.status === "unsupported") {
    return <UnsupportedView message={identityState.message} onLeave={props.onLeave} />;
  }

  const leave = () => {
    ceremony.leave();
    props.onLeave();
  };

  switch (ceremony.phase.kind) {
    case "starting":
      return (
        <StatusView
          label="Preparing this browser…"
          detail="Loading identity, capabilities, and network config."
        />
      );
    case "inviting":
      return (
        <InviteView
          url={ceremony.phase.url}
          artifact={ceremony.phase.artifact}
          qrFriendly={ceremony.phase.qrFriendly}
          onSubmitAnswer={ceremony.submitAnswer}
          onCancel={leave}
        />
      );
    case "reviewing":
      return (
        <PeerConfirmation
          peerName={ceremony.phase.peerName}
          peerSas={ceremony.phase.peerSas}
          peerGhostId={ceremony.phase.peerGhostId}
          onAccept={ceremony.accept}
          onDecline={leave}
        />
      );
    case "preparingAnswer":
      return (
        <StatusView
          label={`Preparing your reply to ${ceremony.phase.peerName}…`}
          detail="Generating an answer, gathering network candidates."
          hints={[
            {
              afterMs: 6_000,
              text:
                "Still gathering — this can take a moment on networks with lots of interfaces (multiple Wi-Fi + Ethernet + VPN).",
            },
          ]}
        />
      );
    case "answering":
      return (
        <JoinView
          peer={{
            name: ceremony.phase.peerName,
            sas: ceremony.phase.peerSas,
          }}
          artifact={ceremony.phase.artifact}
          qrFriendly={ceremony.phase.qrFriendly}
          onCancel={leave}
        />
      );
    case "connecting":
      return (
        <StatusView
          label="Connecting…"
          detail="Punching through your network to reach the other side."
          hints={[
            {
              afterMs: 8_000,
              text:
                "This can take a moment on strict networks — corporate Wi-Fi, some cellular carriers, aggressive VPNs.",
            },
            {
              afterMs: 20_000,
              text:
                "About 15–20% of network pairs (symmetric NAT, corporate firewalls) cannot connect peer-to-peer without a relay. Local v1 does not run one. If this keeps hanging, try a different network — home Wi-Fi or a mobile hotspot often works.",
            },
          ]}
        />
      );
    case "verifying":
      return (
        <StatusView
          label={`Verifying identity — ${ceremony.phase.peerName}`}
          detail={`Fingerprint  ${ceremony.phase.peerSas}`}
          hints={[
            {
              afterMs: 6_000,
              text:
                "Both sides are proving control of their private keys. This finishes in under a second on a healthy connection.",
            },
          ]}
        />
      );
    case "connected":
      return (
        <ChatView
          peerName={ceremony.phase.peerName}
          peerSas={ceremony.phase.peerSas}
          peerGhostId={ceremony.phase.peerGhostId}
          ownGhostId={ceremony.ownGhostId}
          messages={ceremony.messages}
          onSend={ceremony.send}
          onLeave={leave}
        />
      );
    case "interrupted":
      return (
        <StatusView
          label="Connection paused"
          detail="The network dropped. Waiting for it to recover."
          hints={[
            {
              afterMs: 10_000,
              text:
                "If it stays paused, one side probably went offline. Try reconnecting from the other end.",
            },
          ]}
        />
      );
    case "failed":
      return <FailedView message={ceremony.phase.message} onLeave={props.onLeave} />;
    case "closed":
      return (
        <StatusView
          label="Disconnected"
          detail="This session has ended. Your history is still here."
          animated={false}
        />
      );
  }
}

function FailedView({
  message,
  onLeave,
}: {
  message: string;
  onLeave: () => void;
}) {
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
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onLeave}
          className="border border-ink/20 bg-ink px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-paper hover:border-rust hover:bg-rust"
        >
          Try again
        </button>
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
