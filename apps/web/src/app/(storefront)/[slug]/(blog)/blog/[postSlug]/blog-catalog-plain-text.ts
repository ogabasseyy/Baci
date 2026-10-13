import { decodeHTML } from 'entities';
import { resolveBlogCatalogPrices } from '@/lib/resolve-blog-catalog-prices';

/**
 * Resolve catalog-price tokens in plain-text inputs (page metadata, JSON-LD
 * descriptions). Token resolution runs through the HTML sanitizer, which
 * escapes `&` as `&amp;`; decode back so plain-text consumers store the
 * literal text instead of the entity.
 */
export function resolveBlogCatalogPlainText(
  text: string,
  catalogPrices?: Parameters<typeof resolveBlogCatalogPrices>[1]
): string {
  return decodeHTML(
    resolveBlogCatalogPrices({ html: text }, catalogPrices ?? { products: [] })
      .html ?? text
  );
}
