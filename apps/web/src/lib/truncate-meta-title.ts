const ELLIPSIS = '...';
// Only back up to a word boundary when it keeps most of the budget; a single
// very long token is cut mid-word rather than collapsing to a stub.
const MIN_WORD_BOUNDARY_RATIO = 0.6;
const TRAILING_SEPARATOR_PATTERN = /[\s|:,;–—-]+$/;

function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const budget = limit - ELLIPSIS.length;
  if (budget <= 0) {
    return text.slice(0, limit);
  }
  const hardCut = text.slice(0, budget);
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut =
    lastSpace >= budget * MIN_WORD_BOUNDARY_RATIO
      ? hardCut.slice(0, lastSpace)
      : hardCut;
  return `${cut.replace(TRAILING_SEPARATOR_PATTERN, '')}${ELLIPSIS}`;
}

/**
 * Fits an over-length SERP title (already carrying ` | suffix`, if any) into
 * `maxLength`, truncating at a word boundary and keeping the suffix when there
 * is room for it. With `dropSuffixWhenTooLong`, it first drops the brand
 * suffix if the base title then fits whole — for product titles whose ranking
 * phrase ("... Price in Nigeria") sits at the end; search results show the
 * site name separately.
 */
export function truncateMetaTitle(
  title: string,
  suffix: string | undefined,
  maxLength: number,
  options: { dropSuffixWhenTooLong?: boolean } = {}
): string {
  if (title.length <= maxLength) {
    return title;
  }

  const suffixFragment = suffix ? ` | ${suffix}` : '';
  if (suffixFragment && title.endsWith(suffixFragment)) {
    const baseTitle = title.slice(0, -suffixFragment.length).trim();
    if (options.dropSuffixWhenTooLong && baseTitle.length <= maxLength) {
      return baseTitle;
    }
    const baseLimit = maxLength - suffixFragment.length;
    if (baseLimit > ELLIPSIS.length) {
      return `${truncateAtWord(baseTitle, baseLimit)}${suffixFragment}`;
    }
  }

  return truncateAtWord(title, maxLength);
}
