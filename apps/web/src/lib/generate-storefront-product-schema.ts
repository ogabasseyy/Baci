import { getProductSchemaDescription } from './get-product-schema-description';
import type { Product } from './products';
import { generateProductSchema } from './seo-utils';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

/** Build storefront Product JSON-LD with volatile retail claims removed from narrative copy. */
export function generateStorefrontProductSchema(
  product: Product,
  merchantName: string = 'Baci Store',
  currency: string = 'USD',
  country: string = 'NG',
  merchantLogo?: string,
  trustProfile?: MerchantTrustProfile,
  options: {
    acceptedPaymentMethods?: readonly string[];
    productUrl?: string;
  } = {}
) {
  return generateProductSchema(
    product,
    merchantName,
    currency,
    country,
    merchantLogo,
    trustProfile,
    {
      ...options,
      description: getProductSchemaDescription(product, merchantName),
    }
  );
}
