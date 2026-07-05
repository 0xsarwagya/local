import { useEffect, useState } from "react";

import { QrCode } from "./QrCode";

type Props = {
  url: string;
  artifact: string;
  qrFriendly: boolean;
  onSubmitAnswer: (rawAnswerArtifact: string) => void;
  onCancel: () => void;
};

const COPIED_FLASH_MS = 1600;

export function InviteView({
  url,
  artifact,
  qrFriendly,
  onSubmitAnswer,
  onCancel,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [answerPaste, setAnswerPaste] = useState("");

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const submit = () => {
    const trimmed = answerPaste.trim();
    if (trimmed.length === 0) return;
    onSubmitAnswer(trimmed);
  };

  return (
    <div className="flex flex-1 flex-col gap-8 py-8">
      <header className="flex items-baseline justify-between">
        <span className="label">Show them this</span>
        <button
          type="button"
          onClick={onCancel}
          className="label transition-colors hover:text-rust"
        >
          Cancel
        </button>
      </header>

      <div className="flex flex-col items-start gap-6">
        {qrFriendly ? (
          <QrCode text={url} size={288} />
        ) : (
          <p className="max-w-md border border-dashed border-stone/40 p-4 font-mono text-[12px] text-stone">
            Invitation is too large for a reliable QR scan on this device
            (your network has many candidates). Send them the link instead.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={copy}
            className="border border-ink/25 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-rust hover:text-rust"
          >
            {copied ? "Copied" : "Copy invitation"}
          </button>
          <span className="font-mono text-[10px] text-stone/70">
            {artifact.length.toLocaleString()} chars
          </span>
        </div>
      </div>

      <section className="mt-8 flex flex-col gap-3">
        <span className="label">Then paste theirs</span>
        <p className="max-w-md text-[13px] leading-relaxed text-ink/75">
          After they scan or open your invitation, they will show you a
          reply. Paste it here — nothing happens until you do.
        </p>
        <textarea
          value={answerPaste}
          onChange={(e) => setAnswerPaste(e.target.value)}
          placeholder="ho1_…"
          rows={4}
          className="w-full max-w-lg resize-none border border-ink/20 bg-transparent p-3 font-mono text-[11px] leading-relaxed text-ink placeholder:text-stone/40 focus:border-rust focus:outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <div>
          <button
            type="button"
            onClick={submit}
            disabled={answerPaste.trim().length === 0}
            className="border border-ink/25 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-rust hover:text-rust disabled:cursor-not-allowed disabled:opacity-40"
          >
            Connect
          </button>
        </div>
      </section>
    </div>
  );
}
