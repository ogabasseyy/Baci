import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  KNOWN_BRAND_OR_LINE_TOKENS,
  VARIANT_TIER_TOKENS,
} from './ogabassey-catalog-agent-lexicon';

export interface ProductGroundingTokenSet {
  product: StorefrontAgentUiProduct;
  identity: Set<string>;
  features: Set<string>;
}

const NUMERIC_FEATURE_TOKEN =
  /^(?:\d+(?:\.\d+)?(?:gb|tb|mb|mah|k?hz|mhz|ghz|nits|ppi|mp|mm|cm|w|watts?)|1080p|720p|1440p|2160p|4k|5k|8k|5g|4g|wifi\d*)$/i;

const FUSED_SPEC_TECH_TOKEN =
  /^(?:(?:g?ddr|lpddr)\d+[a-z]*|usb\d+[a-z]?|ufs\d+|ip[56]\d)$/i;

const FUSED_SPEC_CONTEXT_WORDS = new Set(
  'ram memory vram sdram storage port ports slot slots water dust resistant resistance rating speed'.split(
    ' '
  )
);

const APPLE_CHIPSET_CODE = /^(?:a1[2-9]|a2\d|m[1-9])$/i;
const APPLE_CHIPSET_TIERS = new Set(['bionic', 'pro', 'max', 'ultra']);
const CHIPSET_TRAILING_CUE =
  /^(?:chip|chipset|processor|soc|cpu|gpu|silicon|engine)$/i;

function isAppleChipsetPhrase(
  words: string[],
  precedingWords: string[],
  followingWords: string[]
): boolean {
  const hasOtherBrandBefore = precedingWords
    .slice(-2)
    .some(
      (token) => KNOWN_BRAND_OR_LINE_TOKENS.has(token) && token !== 'apple'
    );
  if (hasOtherBrandBefore) return false;

  const core = words[0] === 'apple' ? words.slice(1) : words;
  if (core.length === 0 || !APPLE_CHIPSET_CODE.test(core[0])) return false;

  const rest = core.slice(1).filter((t) => !CHIPSET_TRAILING_CUE.test(t));
  const validTier =
    rest.length === 0 ||
    (rest.length === 1 && APPLE_CHIPSET_TIERS.has(rest[0]));
  if (!validTier) return false;

  const hasChipCue =
    rest[0] === 'bionic' ||
    CHIPSET_TRAILING_CUE.test(followingWords[0] ?? '') ||
    core.some((t) => CHIPSET_TRAILING_CUE.test(t));
  return (
    hasChipCue ||
    (rest.length === 1 &&
      /^a(?:1[2-9]|2\d)$/i.test(core[0]) &&
      rest[0] === 'pro')
  );
}

/** Returns true when numeric tokens in a phrase describe specs or versioned standards rather than model identity. */
export function allowsDescriptionFeature(
  words: string[],
  precedingWords: string[] = [],
  followingWords: string[] = []
): boolean {
  const hasFusedSpecPhrase =
    words.some((token) => FUSED_SPEC_TECH_TOKEN.test(token)) &&
    words.some((token) => FUSED_SPEC_CONTEXT_WORDS.has(token)) &&
    words.every(
      (token) =>
        FUSED_SPEC_TECH_TOKEN.test(token) ||
        FUSED_SPEC_CONTEXT_WORDS.has(token) ||
        isNumericFeatureToken(token)
    );
  return (
    hasFusedSpecPhrase ||
    isAppleChipsetPhrase(words, precedingWords, followingWords) ||
    (words.some((token) => /\d/.test(token)) &&
      words.filter((token) => /\d/.test(token)).every(isNumericFeatureToken)) ||
    (isFeatureVersionPhrase(words, precedingWords) &&
      !words.some(
        (token, idx) =>
          KNOWN_BRAND_OR_LINE_TOKENS.has(token) ||
          (VARIANT_TIER_TOKENS.has(token) &&
            !(
              token === 'ultra' &&
              (words[idx - 1] ?? precedingWords.at(-1)) === 'core'
            ))
      ))
  );
}

const FEATURE_VERSION_PREFIXES = new Set(
  'wifi bluetooth usb hdmi pcie thunderbolt displayport ufs lpddr ddr emmc nvme magsafe ios ipados macos watchos android windows ip snapdragon dimensity exynos helio kirin tensor ryzen radeon geforce rtx gtx amoled oled ltpo qled'.split(
    ' '
  )
);

const MULTIWORD_FEATURE_VERSION_PREFIXES: ReadonlyArray<readonly string[]> = [
  ['wi', 'fi'],
  ['gorilla', 'glass'],
  ['ceramic', 'shield'],
];

/** Tokenizes alphanumeric words keeping single digits for model versions like "5". */
export function tokenizeIdentityWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2 || /^\d$/.test(token)
  );
}

/** Identifies spec/resolution/capacity tokens that represent features rather than model numbers. */
export function isNumericFeatureToken(token: string): boolean {
  return NUMERIC_FEATURE_TOKEN.test(token);
}

function collectCoveredVersionIndices(words: string[]): Set<number> {
  const isVersionToken = (token: string | undefined) =>
    token !== undefined && /^\d+[a-z]{0,2}$/.test(token);
  const covered = new Set<number>();
  let hasPrefix = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (FEATURE_VERSION_PREFIXES.has(word)) {
      hasPrefix = true;
      if (isVersionToken(words[i + 1])) covered.add(i + 1);
    }
    if (word === 'gen' && hasPrefix && isVersionToken(words[i + 1])) {
      covered.add(i + 1);
    }
    if (word === 'core') {
      if (/^i[3579]$/i.test(words[i + 1] ?? '')) {
        covered.add(i + 1);
      } else if (words[i + 1] === 'ultra' && isVersionToken(words[i + 2])) {
        covered.add(i + 2);
      } else if (words[i - 1] === 'intel' && isVersionToken(words[i + 1])) {
        covered.add(i + 1);
      }
    }
    for (const prefix of MULTIWORD_FEATURE_VERSION_PREFIXES) {
      if (
        prefix.every((part, partIdx) => words[i + partIdx] === part) &&
        isVersionToken(words[i + prefix.length])
      ) {
        hasPrefix = true;
        covered.add(i + prefix.length);
      }
    }
    if (covered.has(i) && isVersionToken(words[i + 1])) {
      covered.add(i + 1);
    }
  }
  return covered;
}

/** Returns true when `words[index]` is a numeric version token anchored to a feature prefix (e.g. "5" in "Bluetooth 5"). */
export function isFeatureVersionNumberAt(
  words: string[],
  index: number
): boolean {
  const start = Math.max(0, index - 4);
  const covered = collectCoveredVersionIndices(words.slice(start, index + 1));
  return covered.has(index - start);
}

/** Returns true when every numeric version token in `words` is anchored to a recognized standard/component prefix (e.g. Wi-Fi 6, Gorilla Glass 5, Snapdragon 8 Gen 3). */
export function isFeatureVersionPhrase(
  words: string[],
  precedingWords: string[] = []
): boolean {
  const context = precedingWords.slice(-3);
  const combined = [...context, ...words];
  const offset = context.length;
  const covered = collectCoveredVersionIndices(combined);

  let hasMatchedVersionInWords = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!/\d/.test(word) || isNumericFeatureToken(word)) continue;
    if (!covered.has(offset + i)) return false;
    hasMatchedVersionInWords = true;
  }
  return hasMatchedVersionInWords;
}

/** Builds separated per-product identity and descriptive feature token sets alongside the global union. */
export function collectProductGroundingTokens(
  products: StorefrontAgentUiProduct[]
): {
  returnedTokens: Set<string>;
  perProductTokens: ProductGroundingTokenSet[];
} {
  const perProductTokens = products.map((product) => {
    const identity = new Set(
      [product.name, product.brand, product.slug, product.variantModel]
        .filter(Boolean)
        .flatMap((field) => tokenizeIdentityWords(field ?? ''))
    );
    const features = new Set([
      ...identity,
      ...[product.category, product.description]
        .filter(Boolean)
        .flatMap((field) => tokenizeIdentityWords(field ?? '')),
    ]);
    return { product, identity, features };
  });

  const returnedTokens = new Set<string>();
  for (const productSet of perProductTokens) {
    for (const token of productSet.features) returnedTokens.add(token);
  }
  return { returnedTokens, perProductTokens };
}
