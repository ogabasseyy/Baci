import { MOBILE_HERO_LCP_MAX_BYTES } from './hero-mobile-image-config';

/**
 * Given a list of `{ quality, bytes }` candidates ordered from highest to
 * lowest quality (`70 -> 60 -> 50`), selects the highest-quality rung whose
 * byte size is `<= maxBytes` (`MOBILE_HERO_LCP_MAX_BYTES`), falling back to the
 * lowest rung if every candidate exceeds `maxBytes`.
 */
export function selectHeroAvifQualityForByteCap(
  candidates: ReadonlyArray<{ bytes: number; quality: number }>,
  maxBytes = MOBILE_HERO_LCP_MAX_BYTES
): { bytes: number; quality: number } | null {
  if (candidates.length === 0) {
    return null;
  }
  const ordered = [...candidates].sort((a, b) => b.quality - a.quality);
  return (
    ordered.find((candidate) => candidate.bytes <= maxBytes) ??
    ordered[ordered.length - 1]
  );
}
