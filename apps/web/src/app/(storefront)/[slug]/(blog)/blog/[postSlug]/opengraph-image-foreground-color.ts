import { colord, extend } from 'colord';
import namesPlugin from 'colord/plugins/names';

extend([namesPlugin]);

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

const OPAQUE_CARD_BACKING = { r: 26, g: 26, b: 46 } as const;

function compositeOverBackground(
  overlay: string,
  background: RgbColor
): RgbColor | null {
  const parsed = colord(overlay.trim());
  if (!parsed.isValid()) return null;

  const { r, g, b, a } = parsed.toRgb();
  return {
    r: r * a + background.r * (1 - a),
    g: g * a + background.g * (1 - a),
    b: b * a + background.b * (1 - a),
  };
}

function getRelativeLuminance({ r, g, b }: RgbColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function getContrastRatio(firstLuminance: number, secondLuminance: number) {
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Chooses the black or white foreground with the best worst-case contrast. */
export function getBlogOgForegroundColor(
  background: string,
  gradientStops: readonly string[] = []
): string {
  const parsed = colord(background.trim());
  if (!parsed.isValid()) return '#000000';

  const backgroundColor =
    compositeOverBackground(background, OPAQUE_CARD_BACKING) ??
    OPAQUE_CARD_BACKING;
  const surfaceLuminances = [
    getRelativeLuminance(backgroundColor),
    ...gradientStops.flatMap((stop) => {
      const composited = compositeOverBackground(stop, backgroundColor);
      return composited ? [getRelativeLuminance(composited)] : [];
    }),
  ];
  const blackContrast = Math.min(
    ...surfaceLuminances.map((luminance) => getContrastRatio(luminance, 0))
  );
  const whiteContrast = Math.min(
    ...surfaceLuminances.map((luminance) => getContrastRatio(luminance, 1))
  );
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}
