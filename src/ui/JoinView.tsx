import { useEffect, useState } from "react";

import { QrCode } from "./QrCode";

type Props = {
  peer: { name: string; sas: string };
  artifact: string;
  qrFriendly: boolean;
  onCancel: () => void;
};

const COPIED_FLASH_MS = 1600;

export function JoinView({ peer, artifact, qrFriendly, onCancel }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-8 py-8">
      <header className="flex items-baseline justify-between">
        <span className="label">Send them this back</span>
        <button
          type="button"
          onClick={onCancel}
          className="label transition-colors hover:text-rust"
        >
          Cancel
        </button>
      </header>

      <div>
        <p className="font-serif text-[22px] italic">
          Waiting for {peer.name} to accept.
        </p>
        <p className="mt-2 font-mono text-[11px] text-stone">
          Fingerprint · <span className="text-ink">{peer.sas}</span>
        </p>
      </div>

      <div className="flex flex-col items-start gap-6">
        {qrFriendly ? (
          <QrCode text={artifact} size={288} />
        ) : (
          <p className="max-w-md border border-dashed border-stone/40 p-4 font-mono text-[12px] text-stone">
            Reply is too large for a reliable QR scan. Copy it instead.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={copy}
            className="border border-ink/25 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-rust hover:text-rust"
          >
            {copied ? "Copied" : "Copy reply"}
          </button>
          <span className="font-mono text-[10px] text-stone/70">
            {artifact.length.toLocaleString()} chars
          </span>
        </div>
      </div>

      <p className="max-w-md text-[13px] leading-relaxed text-ink/75">
        Paste this into their invite view. Once they connect, this page
        will pick up automatically — no reload required.
      </p>
    </div>
  );
}
