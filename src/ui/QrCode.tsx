import { useMemo } from "react";
import { renderSVG } from "uqr";

/**
 * Zero-dependency QR renderer via uqr. Renders a small quiet-zone and
 * uses currentColor so the code respects the paper/ink palette.
 */
export function QrCode({ text, size = 256 }: { text: string; size?: number }) {
  const svg = useMemo(
    () =>
      renderSVG(text, {
        ecc: "M",
        border: 2,
      }),
    [text],
  );

  return (
    <div
      className="border border-ink/10 bg-paper p-3"
      style={{ width: size, height: size }}
      aria-label="Invitation QR code"
      dangerouslySetInnerHTML={{
        __html: svg
          .replace("<svg ", `<svg width="${size - 24}" height="${size - 24}" `)
          .replace('fill="#000"', 'fill="currentColor"')
          .replace('fill="#fff"', 'fill="transparent"'),
      }}
    />
  );
}
