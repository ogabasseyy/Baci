import type { PublishedClusterPost } from './content-cluster-types';
import { isVariantOnlyComparisonSegment } from './is-variant-only-comparison-segment';
import { tokenizeContentText } from './tokenize-content-text';

type PostTokenGroupSource = Pick<
  PublishedClusterPost,
  'title' | 'excerpt' | 'category' | 'tags' | 'keywords'
>;

const COMPARISON_CUE_PATTERN = /\b(?:compare|comparison|versus|vs)\b/iu;
const MODEL_TOKEN_PATTERN = /\b(?:\d+[a-z]+|[a-z]+\d+|\d+)\b/iu;
const GENERIC_COMPARISON_TOKENS = new Set([
  'buyer',
  'compare',
  'comparison',
  'guide',
  'review',
]);

function hasRepeatedTextModel(left: string, right: string) {
  const leftTokens = new Set(
    tokenizeContentText(left).filter(
      (token) => token.length > 2 && !GENERIC_COMPARISON_TOKENS.has(token)
    )
  );
  const sharedTokens = new Set(
    tokenizeContentText(right).filter((token) => leftTokens.has(token))
  );
  return sharedTokens.size >= 2;
}

function hasXboxSeriesShorthand(left: string, right: string) {
  return (
    /\bxbox\s+series\s+[xs]\s*$/iu.test(left) &&
    /^\s*(?:(?:xbox\s+)?series\s+)?[xs]\b/iu.test(right)
  );
}

function normalizeComparisonSeparators(value: string) {
  const hasComparisonCue = COMPARISON_CUE_PATTERN.test(value);
  return value.replace(/\s*[&/|]\s*/gu, (separator, offset: number) => {
    const left = value.slice(0, offset);
    const right = value.slice(offset + separator.length);
    const leftSegment = left.split(COMPARISON_CUE_PATTERN).at(-1) ?? left;
    const rightSegment = right.split(COMPARISON_CUE_PATTERN)[0] ?? right;
    const hasModelOnBothSides =
      MODEL_TOKEN_PATTERN.test(leftSegment) &&
      MODEL_TOKEN_PATTERN.test(rightSegment);
    const hasTextModelOnBothSides =
      hasComparisonCue && hasRepeatedTextModel(leftSegment, rightSegment);
    const hasSingleLetterModelOnBothSides =
      hasComparisonCue && hasXboxSeriesShorthand(leftSegment, rightSegment);
    const hasVariantOnlyRightSide =
      hasComparisonCue &&
      isVariantOnlyComparisonSegment(tokenizeContentText(rightSegment));
    const hasSeparatorWhitespace = /\s/u.test(separator);
    return (hasModelOnBothSides ||
      hasTextModelOnBothSides ||
      hasSingleLetterModelOnBothSides ||
      hasVariantOnlyRightSide) &&
      (hasSeparatorWhitespace || hasComparisonCue)
      ? ' versus '
      : separator;
  });
}

export function getPostTokenGroups(post: PostTokenGroupSource) {
  return [
    post.title,
    post.excerpt,
    post.category,
    ...(post.tags ?? []),
    ...(post.keywords ?? []),
  ].map((value) =>
    tokenizeContentText(normalizeComparisonSeparators(value ?? ''))
  );
}
