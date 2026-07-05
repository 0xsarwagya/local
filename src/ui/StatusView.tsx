type Props = {
  label: string;
  detail?: string;
};

/** Small placeholder card used for loading/connecting/verifying phases. */
export function StatusView({ label, detail }: Props) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-24">
      <span className="label">Local</span>
      <p className="font-serif text-[24px] italic">{label}</p>
      {detail ? (
        <p className="font-mono text-[12px] text-stone">{detail}</p>
      ) : null}
    </div>
  );
}
