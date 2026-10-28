export const MOBILE_HERO_IMAGE_WIDTH = 960;
export const MOBILE_HERO_IMAGE_HEIGHT = 540;
// The mobile hero image renders in HERO_MOBILE_IMAGE_COLUMN_CLASSES
// ('col-span-2' of grid-cols-5 = 40% of the px-4 container ≈ 37vw at 412px).
// Declaring 100vw here made the browser pick the width=1200 srcset candidate
// (~90KB) for a ~152 CSS-px slot — on Slow-4G that oversize WAS the ~6s lab
// LCP (DebugBear waterfall 2026-07-10). 40vw selects width=640 (~25KB) at
// DPR≈2.6; slightly over-provisioned on purpose (over = safe, under = blurry).
export const MOBILE_HERO_IMAGE_SIZES = '(max-width: 767px) 40vw, 50vw';
export const MOBILE_HERO_SOURCE_MEDIA = '(max-width: 767px)';
export const DESKTOP_HERO_SOURCE_MEDIA = '(min-width: 768px)';
export const MOBILE_HERO_IMAGE_QUALITY = 70;
export const MOBILE_HERO_MIN_SRCSET_WIDTH = 384;
export const MOBILE_HERO_MAX_SRCSET_WIDTH = 750;
export const DESKTOP_HERO_BIG_MIN_SRCSET_WIDTH = 640;
export const DESKTOP_HERO_BIG_MAX_SRCSET_WIDTH = 1080;
export const DESKTOP_HERO_SIDE_MAX_SRCSET_WIDTH = 384;
export const TRANSPARENT_PIXEL_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const MAX_INLINE_SOURCE_SRCSET_CHARS = 360;

interface ParsedSrcSetCandidate {
  raw: string;
  width: number | null;
}

function parseSrcSetCandidate(candidate: string): ParsedSrcSetCandidate {
  const trimmed = candidate.trim();
  const match = trimmed.match(/\s+(\d+)w$/i);
  return {
    raw: trimmed,
    width: match ? Number.parseInt(match[1], 10) : null,
  };
}

function clampCandidateToMaxWidth(
  candidate: ParsedSrcSetCandidate,
  maxWidth: number
): ParsedSrcSetCandidate {
  const clampedRaw = candidate.raw
    .replace(/\bwidth=\d+/i, `width=${maxWidth}`)
    .replace(/([?&]w=)\d+/i, `$1${maxWidth}`)
    .replace(/\s+\d+w$/i, ` ${maxWidth}w`);
  return {
    raw: clampedRaw,
    width: maxWidth,
  };
}

/**
 * Cap responsive `srcSet` width rungs so hero `<picture>` elements never
 * advertise oversized desktop variants or exceed React 19 Fizz's 500-byte
 * inline `<Suspense>` boundary budget.
 */
export function capSrcSetWidthRungs(
  srcSet: string | undefined,
  maxWidth: number,
  minWidth = 0,
  maxRungs = 2
): string | undefined {
  if (!srcSet) {
    return srcSet;
  }

  const candidates = srcSet
    .split(/,\s+/)
    .map(parseSrcSetCandidate)
    .filter((entry) => entry.raw.length > 0);
  if (
    candidates.length === 0 ||
    candidates.every((entry) => entry.width === null)
  ) {
    return srcSet;
  }

  const sorted = [...candidates].sort(
    (a, b) =>
      (a.width ?? Number.MAX_SAFE_INTEGER) -
      (b.width ?? Number.MAX_SAFE_INTEGER)
  );
  const underMax = sorted.filter(
    (entry) => entry.width === null || entry.width <= maxWidth
  );
  const boundedMax =
    underMax.length > 0
      ? underMax
      : [clampCandidateToMaxWidth(sorted[0], maxWidth)];
  const aboveMin = boundedMax.filter(
    (entry) => entry.width === null || entry.width >= minWidth
  );
  const bounded = aboveMin.length > 0 ? aboveMin : boundedMax;

  const selected =
    bounded.length > maxRungs && maxRungs >= 2
      ? [bounded[0], bounded[bounded.length - 1]]
      : bounded.slice(0, Math.max(1, maxRungs));

  const joined = selected.map((entry) => entry.raw).join(', ');
  if (joined.length > MAX_INLINE_SOURCE_SRCSET_CHARS && selected.length > 1) {
    return selected[selected.length - 1].raw;
  }

  return joined;
}
