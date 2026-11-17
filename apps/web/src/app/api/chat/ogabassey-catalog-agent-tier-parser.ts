import {
  GENERIC_PRODUCT_NAME_WORDS,
  KNOWN_BRAND_OR_LINE_TOKENS,
  POSITIVE_AVAILABILITY_GENERIC_WORDS,
  VARIANT_TIER_TOKENS,
} from './ogabassey-catalog-agent-lexicon';

const CHIP_OR_CODE_TIER_TOKENS = new Set([
  'fe',
  'se',
  'm1',
  'm2',
  'm3',
  'm4',
  'm5',
]);

const PROSE_PLUS_FOLLOWERS =
  /^(?:a|an|the|free|bonus|extra|accessories|earbuds|airpods|charger|chargers|case|cases|warranty|delivery|buds|cable|cables)$/i;

function isModelAnchorToken(
  token: string,
  productIdentityTokens: Set<string>
): boolean {
  if (/\d/.test(token) || KNOWN_BRAND_OR_LINE_TOKENS.has(token)) return true;
  return (
    productIdentityTokens.has(token) &&
    !GENERIC_PRODUCT_NAME_WORDS.has(token) &&
    !POSITIVE_AVAILABILITY_GENERIC_WORDS.has(token)
  );
}

/** Extracts variant tier/chip tokens syntactically attached to a product model in a clause. */
export function collectModelAttachedTierTokens(
  segment: string,
  productIdentityTokens: Set<string>
): Set<string> {
  const tokens = [...segment.matchAll(/[A-Za-z0-9]+/g)].map((m) => ({
    raw: m[0],
    lower: m[0].toLowerCase(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const contiguous = (i: number, j: number) =>
    i >= 0 &&
    j < tokens.length &&
    /^[\s-]+$/.test(segment.slice(tokens[i].end, tokens[j].start));
  const attached = new Set<string>();
  const attachedIdx = new Set<number>();

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < tokens.length; i++) {
      const { raw, lower } = tokens[i];
      if (!VARIANT_TIER_TOKENS.has(lower) || attachedIdx.has(i)) continue;
      if (
        lower === 'plus' &&
        raw === 'plus' &&
        contiguous(i, i + 1) &&
        PROSE_PLUS_FOLLOWERS.test(tokens[i + 1].lower)
      ) {
        continue;
      }
      const prevLinked =
        contiguous(i - 1, i) &&
        (attachedIdx.has(i - 1) ||
          isModelAnchorToken(tokens[i - 1].lower, productIdentityTokens));
      const nextLinked =
        contiguous(i, i + 1) &&
        (attachedIdx.has(i + 1) ||
          isModelAnchorToken(tokens[i + 1].lower, productIdentityTokens));
      if (CHIP_OR_CODE_TIER_TOKENS.has(lower) || prevLinked || nextLinked) {
        attached.add(lower);
        attachedIdx.add(i);
      }
    }
  }
  return attached;
}
