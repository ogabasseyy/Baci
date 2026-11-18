import {
  isFeatureVersionNumberAt,
  isNumericFeatureToken,
} from './ogabassey-catalog-agent-grounding-tokens';
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

const CONNECTIVITY_MODEL_TOKENS = new Set(['4g', '5g']);
const CHIPSET_CODE_BEFORE_TIER = /^(?:a1[2-9]|a2\d|m[1-9]|core)$/i;
const CHIPSET_TRAILING_CUE =
  /^(?:chip|chipset|processor|soc|cpu|gpu|silicon|engine)$/i;

interface ParsedToken {
  raw: string;
  lower: string;
  start: number;
  end: number;
}

function isContiguousPair(
  segment: string,
  tokens: ParsedToken[],
  i: number,
  j: number
): boolean {
  return (
    i >= 0 &&
    j < tokens.length &&
    /^[\s-]+$/.test(segment.slice(tokens[i].end, tokens[j].start))
  );
}

function isNumericFeatureTokenAt(
  segment: string,
  tokens: ParsedToken[],
  lowerTokens: string[],
  index: number
): boolean {
  const token = lowerTokens[index];
  if (token === undefined) return false;
  if (isNumericFeatureToken(token)) return true;
  return (
    /^\d+(?:\.\d+)?$/.test(token) &&
    isContiguousPair(segment, tokens, index, index + 1) &&
    isNumericFeatureToken(`${token}${lowerTokens[index + 1]}`)
  );
}

function isModelAnchorToken(
  segment: string,
  tokens: ParsedToken[],
  lowerTokens: string[],
  index: number,
  productIdentityTokens: Set<string>,
  allowConnectivity = true
): boolean {
  const token = lowerTokens[index];
  if (isFeatureVersionNumberAt(lowerTokens, index)) return false;
  if (CONNECTIVITY_MODEL_TOKENS.has(token)) {
    return (
      allowConnectivity &&
      isContiguousPair(segment, tokens, index - 1, index) &&
      isModelAnchorToken(
        segment,
        tokens,
        lowerTokens,
        index - 1,
        productIdentityTokens,
        false
      )
    );
  }
  if (isNumericFeatureTokenAt(segment, tokens, lowerTokens, index)) {
    return false;
  }
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
  const tokens: ParsedToken[] = [...segment.matchAll(/[A-Za-z0-9]+/g)].map(
    (m) => ({
      raw: m[0],
      lower: m[0].toLowerCase(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    })
  );
  const lowerTokens = tokens.map((token) => token.lower);
  const attached = new Set<string>();
  const attachedIdx = new Set<number>();

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < tokens.length; i++) {
      const { raw, lower } = tokens[i];
      if (!VARIANT_TIER_TOKENS.has(lower) || attachedIdx.has(i)) continue;
      if (
        isContiguousPair(segment, tokens, i - 1, i) &&
        isContiguousPair(segment, tokens, i, i + 1) &&
        CHIPSET_CODE_BEFORE_TIER.test(tokens[i - 1].lower) &&
        !productIdentityTokens.has(tokens[i - 1].lower) &&
        CHIPSET_TRAILING_CUE.test(tokens[i + 1].lower)
      ) {
        continue;
      }
      const prevLinked =
        isContiguousPair(segment, tokens, i - 1, i) &&
        (attachedIdx.has(i - 1) ||
          isModelAnchorToken(
            segment,
            tokens,
            lowerTokens,
            i - 1,
            productIdentityTokens
          ));
      const nextLinked =
        isContiguousPair(segment, tokens, i, i + 1) &&
        (attachedIdx.has(i + 1) ||
          isModelAnchorToken(
            segment,
            tokens,
            lowerTokens,
            i + 1,
            productIdentityTokens
          ));
      if (
        lower === 'plus' &&
        raw === 'plus' &&
        isContiguousPair(segment, tokens, i, i + 1) &&
        (PROSE_PLUS_FOLLOWERS.test(tokens[i + 1].lower) ||
          (!prevLinked &&
            isNumericFeatureTokenAt(segment, tokens, lowerTokens, i + 1)))
      ) {
        continue;
      }
      if (
        /^m[1-9]$/i.test(lower) &&
        isContiguousPair(segment, tokens, i, i + 1) &&
        CHIPSET_TRAILING_CUE.test(tokens[i + 1].lower)
      ) {
        continue;
      }
      if (CHIP_OR_CODE_TIER_TOKENS.has(lower) || prevLinked || nextLinked) {
        attached.add(lower);
        attachedIdx.add(i);
      }
    }
  }
  return attached;
}
