import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';

export interface ProductGroundingTokenSet {
  product: StorefrontAgentUiProduct;
  identity: Set<string>;
  features: Set<string>;
}

const NUMERIC_FEATURE_TOKEN =
  /^(?:\d+(?:\.\d+)?(?:gb|tb|mb|mah|k?hz|mhz|ghz|nits|ppi|mp|mm|cm|w|watts?)|1080p|720p|1440p|2160p|4k|5k|8k|5g|4g|wifi\d*)$/i;

const FEATURE_VERSION_PREFIXES = new Set(
  'wifi bluetooth usb hdmi pcie thunderbolt displayport ufs lpddr ddr emmc nvme gorilla magsafe ios ipados macos watchos android windows core ryzen snapdragon dimensity helio exynos bionic gen ip'.split(
    ' '
  )
);

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

/** Returns true when a phrase contains a standard/connectivity/spec prefix (e.g. Wi-Fi 6, USB 3.2, Bluetooth 5.3). */
export function isFeatureVersionPhrase(words: string[]): boolean {
  return words.some(
    (word, idx) =>
      FEATURE_VERSION_PREFIXES.has(word) ||
      (word === 'wi' && words[idx + 1] === 'fi')
  );
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
