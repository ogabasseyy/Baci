import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { getProductModelIdentifiers } from './get-product-model-identifiers';
import { tokenizeContentText } from './tokenize-content-text';

const LAPTOP_CATEGORY_SLUGS = new Set(['gaming-laptops', 'laptops']);

function hasTokenSequence(tokens: string[], expected: string[]) {
  return tokens.some((_, startIndex) =>
    expected.every((token, offset) => tokens[startIndex + offset] === token)
  );
}

/** Adds only numeric laptop-family phrases proven by the catalog source. */
export function getProductGuideModelIdentifiers(
  context: BuildCommercialGuideLinksContext
) {
  const identifiers = getProductModelIdentifiers(context);
  if (!LAPTOP_CATEGORY_SLUGS.has(context.categorySlug)) {
    return identifiers;
  }

  const sources = [
    ...(context.productNames ?? []),
    ...(context.productSlugs ?? []),
  ];
  const sourceTokenGroups = sources.map(tokenizeContentText);
  const provenIdentifiers = identifiers.flatMap((identifier) => {
    const identifierTokens = tokenizeContentText(identifier);
    const modelCode = identifierTokens.at(-1) ?? '';
    if (identifierTokens.length < 2 || !/^\d{3,}$/u.test(modelCode)) {
      return [];
    }
    const familyTokens = identifierTokens.slice(0, -1);
    return sourceTokenGroups.flatMap((sourceTokens) =>
      sourceTokens
        .filter((token) => /^\d{1,2}$/u.test(token))
        .map((numericFamily) => [...familyTokens, numericFamily, modelCode])
        .filter((candidate) => hasTokenSequence(sourceTokens, candidate))
        .map((candidate) => candidate.join(' '))
    );
  });
  return Array.from(new Set([...identifiers, ...provenIdentifiers]));
}
