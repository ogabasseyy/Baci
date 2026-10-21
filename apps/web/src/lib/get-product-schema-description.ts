import { getDurableProductSeoText } from './get-durable-product-seo-text';
import { generateMetaDescription } from './meta-description';
import type { Product } from './products';
import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';

/** Product narrative stays price-free; authoritative prices live in Offer data. */
export function getProductSchemaDescription(
  product: Pick<Product, 'name' | 'slug' | 'description' | 'meta_description'>,
  merchantName: string,
  currency: string
): string {
  for (const text of [product.description, product.meta_description]) {
    const durable = getDurableProductSeoText({ text, product, currency });
    if (durable && !isUnsupportedSpecValue(durable)) {
      return generateMetaDescription(durable, 500);
    }
  }
  return `Buy ${product.name} from ${merchantName}. Best prices, fast delivery, and secure payments.`;
}
