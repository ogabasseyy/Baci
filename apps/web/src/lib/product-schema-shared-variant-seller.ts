import { getProductScopedPrefix } from './product-schema-scoped-id-prefix';

type NodeReference = { '@id': string };

export interface OfferSellerEntity {
  '@type': 'Organization';
  '@id'?: string;
  name: string;
  acceptedPaymentMethod?: string[];
}

/**
 * Define the merchant Organization seller node (including acceptedPaymentMethod)
 * once on the first variant Offer with an `@id`, and reference it by `@id` from
 * subsequent variant Offers so merchant payment/seller boilerplate is not
 * duplicated across every `hasVariant` entry.
 */
export function buildSharedVariantOfferSeller(
  productUrl: URL | undefined,
  productGroupId: string,
  variantCount: number,
  seller: { '@type': 'Organization'; '@id'?: string; name: string },
  acceptedPaymentMethod?: readonly string[]
): (variantIndex: number) => OfferSellerEntity | NodeReference {
  const normalizedMethods =
    acceptedPaymentMethod && acceptedPaymentMethod.length > 0
      ? [...acceptedPaymentMethod]
      : undefined;

  const sellerWithPaymentMethods: OfferSellerEntity = {
    ...seller,
    ...(normalizedMethods && { acceptedPaymentMethod: normalizedMethods }),
  };

  if (variantCount <= 1) {
    return () => sellerWithPaymentMethods;
  }

  const sellerId =
    seller['@id'] ||
    `${getProductScopedPrefix(productUrl, productGroupId)}seller`;

  const definition: OfferSellerEntity = {
    ...sellerWithPaymentMethods,
    '@id': sellerId,
  };
  const reference: NodeReference = { '@id': sellerId };

  return (variantIndex) => (variantIndex === 0 ? definition : reference);
}
