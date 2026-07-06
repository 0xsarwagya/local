import { useEffect, useState } from "react";

type Hint = {
  /** Seconds since this hint became relevant before showing it. */
  afterMs: number;
  text: string;
};

type Props = {
  label: string;
  detail?: string;
  /**
   * Timed hints that appear one-at-a-time. If afterMs elapses in this
   * view without the phase changing, the hint text replaces the previous
   * hint (or appears fresh). Useful for surfacing "this can take a
   * moment on strict networks" without moving the user to a failed screen.
   */
  hints?: Hint[];
  /** Show an animated dot next to the label. Defaults to true. */
  animated?: boolean;
};

/** Placeholder card used for loading/connecting/verifying phases. */
export function StatusView({ label, detail, hints, animated = true }: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!hints || hints.length === 0) return;
    const start = performance.now();
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - start);
    }, 500);
    return () => window.clearInterval(id);
  }, [hints]);

  const activeHint = hints
    ? [...hints].reverse().find((h) => elapsedMs >= h.afterMs)
    : undefined;

  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-24">
      <span className="label flex items-center gap-2">
        Local
        {animated ? (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rust"
          />
        ) : null}
      </span>
      <p className="font-serif text-[24px] italic">{label}</p>
      {detail ? (
        <p className="font-mono text-[12px] text-stone">{detail}</p>
      ) : null}
      {activeHint ? (
        <p
          key={activeHint.text}
          className="max-w-md animate-[fadein_500ms_ease] text-[13px] leading-relaxed text-ink/75"
        >
          {activeHint.text}
        </p>
      ) : null}
    </div>
  );
}
