import { generateSlug } from '@/lib/seo-utils';
import { tokenizeContentText } from './tokenize-content-text';

function resolveExplicitBrandKey(
  brand: string,
  brandAliases: Record<string, readonly string[]>
) {
  if (Object.hasOwn(brandAliases, brand)) {
    return brand;
  }

  const brandTokens = new Set(tokenizeContentText(brand));
  const canonicalBrand = Object.keys(brandAliases).find((candidate) =>
    tokenizeContentText(candidate).every((token) => brandTokens.has(token))
  );
  if (canonicalBrand) {
    return canonicalBrand;
  }

  return (
    Object.entries(brandAliases).find(([, aliases]) =>
      aliases.some((alias) =>
        tokenizeContentText(alias).every((token) => brandTokens.has(token))
      )
    )?.[0] ?? brand
  );
}

/** Resolves configured canonical brands from explicit context or product names. */
export function getContextBrandKeys(
  brands: readonly string[] | undefined,
  productNames: readonly string[] | undefined,
  brandAliases: Record<string, readonly string[]>
) {
  const productNameTokens = new Set(
    (productNames ?? []).flatMap(tokenizeContentText)
  );
  const canonicalProductNameKeys = Object.keys(brandAliases).filter((brand) =>
    tokenizeContentText(brand).every((token) => productNameTokens.has(token))
  );
  const productNameBrandKeys =
    canonicalProductNameKeys.length > 0
      ? canonicalProductNameKeys
      : Object.entries(brandAliases)
          .filter(([, aliases]) =>
            aliases.some((alias) =>
              tokenizeContentText(alias).every((token) =>
                productNameTokens.has(token)
              )
            )
          )
          .map(([brand]) => brand);
  const explicitBrandKeys = Array.from(
    new Set((brands ?? []).map(generateSlug).filter(Boolean))
  );
  if (explicitBrandKeys.length > 0) {
    const resolvedExplicitBrandKeys = explicitBrandKeys.map((brand) =>
      resolveExplicitBrandKey(brand, brandAliases)
    );
    const approvedProductNameKeys = new Set(
      resolvedExplicitBrandKeys.flatMap((brand) => [
        brand,
        ...(brandAliases[brand] ?? []).map((alias) =>
          resolveExplicitBrandKey(generateSlug(alias), brandAliases)
        ),
      ])
    );
    return Array.from(
      new Set([
        ...resolvedExplicitBrandKeys,
        ...productNameBrandKeys.filter((brand) =>
          approvedProductNameKeys.has(brand)
        ),
      ])
    );
  }

  return productNameBrandKeys;
}
