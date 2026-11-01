import { stripHtmlTags } from './sanitize-core';

const ELLIPSIS = '...';
const ELLIPSIS_LENGTH = ELLIPSIS.length;
const DEFAULT_MAX_LENGTH = 160;
const DEFAULT_TITLE_MAX_LENGTH = 70;

// Unambiguous meta-title separators. A bare hyphen (`-`) is intentionally
// excluded because product names regularly contain internal hyphens
// (e.g. `MacBook-Pro`, `iPhone-256GB`) and treating them as separators
// causes `removeTrailingDuplicateSuffix` to strip legitimate name segments.
// The spaced hyphen ` - ` is handled explicitly below as a separate branch.
const META_TITLE_SEPARATORS = ['|', '–', '—', ':'] as const;
const META_TITLE_SPACED_HYPHEN = ' - ';

function validateMaxLength(value: number): number {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    value <= ELLIPSIS_LENGTH
  ) {
    return DEFAULT_MAX_LENGTH;
  }
  return value;
}

function normalizePlainText(value: string): string {
  return stripHtmlTags(value).replace(/\s+/g, ' ').trim();
}

function stringsMatchCaseInsensitive(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'base' }) === 0;
}

function getTrailingSeparatedSegment(value: string) {
  const trimmedValue = value.trim();

  let bestIndex = -1;
  let separatorLength = 0;

  for (const separator of META_TITLE_SEPARATORS) {
    const index = trimmedValue.lastIndexOf(separator);
    if (index > bestIndex) {
      bestIndex = index;
      separatorLength = separator.length;
    }
  }

  // Spaced hyphen (` - `) is treated as a separator too, but bare hyphens
  // are ignored so product names with internal hyphens aren't mangled.
  const spacedHyphenIndex = trimmedValue.lastIndexOf(META_TITLE_SPACED_HYPHEN);
  if (spacedHyphenIndex > bestIndex) {
    bestIndex = spacedHyphenIndex;
    separatorLength = META_TITLE_SPACED_HYPHEN.length;
  }

  if (bestIndex === -1) {
    return null;
  }

  const base = trimmedValue.slice(0, bestIndex).trim();
  const suffix = trimmedValue.slice(bestIndex + separatorLength).trim();

  if (!base || !suffix) {
    return null;
  }

  return { base, suffix };
}

function removeTrailingDuplicateSuffix(value: string, suffix: string): string {
  const normalizedSuffix = normalizePlainText(suffix);
  if (!normalizedSuffix) {
    return value;
  }

  let normalizedValue = normalizePlainText(value);

  while (true) {
    const trailingSegment = getTrailingSeparatedSegment(normalizedValue);
    if (
      !trailingSegment ||
      !stringsMatchCaseInsensitive(trailingSegment.suffix, normalizedSuffix)
    ) {
      break;
    }

    const nextValue = trailingSegment.base;
    if (!nextValue || nextValue === normalizedValue) {
      break;
    }
    normalizedValue = nextValue;
  }

  return normalizedValue;
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const rawSlice = value.slice(0, maxLength);
  if (/\s/.test(value[maxLength] ?? '')) {
    return rawSlice.replace(/[\s,;:|\-–—]+$/, '') || rawSlice;
  }
  const lastSpaceIndex = rawSlice.lastIndexOf(' ');
  const candidate =
    lastSpaceIndex >= Math.floor(maxLength * 0.5)
      ? rawSlice.slice(0, lastSpaceIndex)
      : rawSlice;
  return candidate.replace(/[\s,;:|\-–—]+$/, '') || rawSlice;
}

/**
 * Generates a normalized SEO title with optional suffix and word-boundary length cap.
 */
export function generateMetaTitle(
  title: string,
  options?: {
    maxLength?: number;
    suffix?: string;
    fallback?: string;
  }
): string {
  const maxLength = validateMaxLength(
    options?.maxLength ?? DEFAULT_TITLE_MAX_LENGTH
  );
  const fallback = normalizePlainText(options?.fallback || '');
  let normalizedTitle = normalizePlainText(title) || fallback;
  const suffix = normalizePlainText(options?.suffix || '');

  if (!normalizedTitle) {
    normalizedTitle = suffix;
  }

  if (!normalizedTitle) {
    return '';
  }

  if (suffix) {
    const baseTitle = removeTrailingDuplicateSuffix(normalizedTitle, suffix);
    const trailingSegment = getTrailingSeparatedSegment(baseTitle);
    const hasSuffix =
      stringsMatchCaseInsensitive(baseTitle, suffix) ||
      (trailingSegment
        ? stringsMatchCaseInsensitive(trailingSegment.suffix, suffix)
        : false);
    normalizedTitle = hasSuffix ? baseTitle : `${baseTitle} | ${suffix}`;
  }

  if (normalizedTitle.length <= maxLength) {
    return normalizedTitle;
  }

  if (suffix) {
    const normalizedSuffix = normalizePlainText(suffix);
    const suffixFragment = ` | ${normalizedSuffix}`;
    if (normalizedTitle.endsWith(suffixFragment)) {
      const baseTitle = normalizedTitle
        .slice(0, normalizedTitle.length - suffixFragment.length)
        .trim();
      const allowedBaseLength =
        maxLength - suffixFragment.length - ELLIPSIS_LENGTH;

      if (allowedBaseLength > 0) {
        return `${truncateAtWordBoundary(baseTitle, allowedBaseLength)}${ELLIPSIS}${suffixFragment}`;
      }
    }
  }

  return `${truncateAtWordBoundary(normalizedTitle, maxLength - ELLIPSIS_LENGTH)}${ELLIPSIS}`;
}
