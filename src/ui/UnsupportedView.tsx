type Props = {
  message: string;
  onLeave: () => void;
};

export function UnsupportedView({ message, onLeave }: Props) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 py-16">
      <span className="label">This browser</span>
      <p className="font-serif text-[22px] italic">
        Local can&rsquo;t run here.
      </p>
      <p className="max-w-md font-mono text-[12px] text-stone">{message}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-ink/75">
        Local needs Web Crypto with Ed25519 and IndexedDB. Try a recent
        Chromium, Firefox, or Safari — the desktop builds work best.
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
