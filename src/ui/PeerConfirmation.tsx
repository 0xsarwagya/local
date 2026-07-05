type Props = {
  peerName: string;
  peerSas: string;
  peerGhostId: string;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * First-contact confirmation card. Shows the untrusted display name
 * plus the SAS fingerprint the user should compare visually against
 * what the peer sees on their side.
 */
export function PeerConfirmation({
  peerName,
  peerSas,
  peerGhostId,
  onAccept,
  onDecline,
}: Props) {
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
        Before accepting: ask them out-of-band (over a call, or by looking
        at their screen) that the fingerprint on their side matches the one
        above. Local can&rsquo;t prove who they are on first contact for
        you.
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
