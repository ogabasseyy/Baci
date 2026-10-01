/** Selects one model identifier per product, falling back from a name to its slug. */
const VARIANT_METADATA_TOKEN_PATTERN =
  /^(?:\d+(?:gb|tb|mb|mm|inch)?|4g|5g|bluetooth|bt|cellular|dual|esim|gps|lte|nano|physical|sim|single|wifi)$/u;
const MODEL_EXTENSION_TOKENS = new Set([
  'air',
  'airpods',
  'buds',
  'edge',
  'fe',
  'flip',
  'fold',
  'galaxy',
  'inspiron',
  'latitude',
  'legion',
  'lite',
  'max',
  'mini',
  'neo',
  'note',
  'omen',
  'pad',
  'pavilion',
  'pixel',
  'plus',
  'power',
  'prime',
  'pro',
  'quest',
  'redmi',
  'rog',
  'series',
  'se',
  'spark',
  'surface',
  'thinkpad',
  'ultra',
  'watch',
  'xps',
]);

type IdentifierCandidate = {
  value: string;
  source: 'name' | 'slug';
};

function isModelSpecificSlugExtensionToken(token: string) {
  return /\d/u.test(token) || MODEL_EXTENSION_TOKENS.has(token);
}

function selectMostSpecificIdentifier(
  identifiers: readonly IdentifierCandidate[]
): string | undefined {
  return identifiers.reduce<IdentifierCandidate | undefined>(
    (selected, candidate) => {
      if (!selected) {
        return candidate;
      }
      const selectedTokens = selected.value.split(/\s+/u);
      const candidateTokens = candidate.value.split(/\s+/u);
      let selectedIndex = 0;
      for (const token of candidateTokens) {
        if (token === selectedTokens[selectedIndex]) {
          selectedIndex += 1;
        }
      }
      const extendsSelected = selectedIndex === selectedTokens.length;
      const extensionTokens = candidateTokens.filter(
        (token) => !selectedTokens.includes(token)
      );
      const addsModelSpecificity = extensionTokens.some(
        (token) =>
          !VARIANT_METADATA_TOKEN_PATTERN.test(token) ||
          (/^\d+$/u.test(token) &&
            selectedTokens.some((selectedToken) =>
              /[a-z]/u.test(selectedToken)
            ))
      );
      const slugAddsUnprovenCopy =
        candidate.source === 'slug' &&
        selected.source === 'name' &&
        extensionTokens.some(
          (token) =>
            !VARIANT_METADATA_TOKEN_PATTERN.test(token) &&
            !isModelSpecificSlugExtensionToken(token)
        );
      return extendsSelected && addsModelSpecificity && !slugAddsUnprovenCopy
        ? candidate
        : selected;
    },
    undefined
  )?.value;
}

export function getProductModelIdentifiersFromSources(
  productNames: readonly string[] | undefined,
  productSlugs: readonly string[] | undefined,
  getIdentifier: (source: string) => string | null | undefined
) {
  const names = productNames ?? [];
  const slugs = productSlugs ?? [];
  const primarySources = names.length > 0 ? names : slugs;

  return Array.from(
    new Set(
      primarySources
        .map((source, index) => {
          const identifiers: IdentifierCandidate[] = [];
          const primaryIdentifier = getIdentifier(source);
          if (primaryIdentifier) {
            identifiers.push({
              value: primaryIdentifier,
              source: names.length > 0 ? 'name' : 'slug',
            });
          }
          if (names.length > 0 && slugs[index]) {
            const slugIdentifier = getIdentifier(slugs[index] ?? '');
            if (slugIdentifier) {
              identifiers.push({ value: slugIdentifier, source: 'slug' });
            }
          }
          return selectMostSpecificIdentifier(identifiers);
        })
        .filter((identifier): identifier is string => Boolean(identifier))
    )
  );
}
