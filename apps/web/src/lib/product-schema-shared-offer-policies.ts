import type { MerchantReturnPolicy, OfferShippingDetails } from 'schema-dts';

type NodeReference = { '@id': string };

export interface OfferSellerEntity {
  '@type': 'Organization';
  '@id'?: string;
  name: string;
  acceptedPaymentMethod?: string[];
}

export interface SharedOfferPolicies {
  shippingDetails?: OfferShippingDetails | NodeReference;
  hasMerchantReturnPolicy?: MerchantReturnPolicy | NodeReference;
}

function getProductScopedPrefix(
  productUrl: URL | undefined,
  productGroupId: string
): string {
  return productUrl
    ? `${productUrl.origin}${productUrl.pathname}#`
    : `#${encodeURIComponent(productGroupId)}-`;
}

/**
 * Every variant Offer of a ProductGroup carries the same shipping and return
 * policy. Define both nodes once (on the first Offer) with an `@id` and point
 * later Offers at them, matching Google's product-variants example. The JSON-LD
 * graph is unchanged, but a 50-variant PDP stops repeating ~1KB per variant in
 * both the HTML and the RSC payload. Ids are page-scoped by the product URL,
 * or by the product group id when the URL is unknown, so two products on one
 * page never share a node.
 * @see https://developers.google.com/search/docs/appearance/structured-data/product-variants
 */
export function buildSharedOfferPolicies(
  productUrl: URL | undefined,
  productGroupId: string,
  shippingDetails?: OfferShippingDetails,
  returnPolicy?: MerchantReturnPolicy
): (variantIndex: number) => SharedOfferPolicies {
  if (!shippingDetails && !returnPolicy) {
    return () => ({});
  }

  const prefix = getProductScopedPrefix(productUrl, productGroupId);
  const shippingId = `${prefix}shipping-policy`;
  const returnPolicyId = `${prefix}return-policy`;

  const definitions: SharedOfferPolicies = {
    ...(shippingDetails && {
      shippingDetails: { ...shippingDetails, '@id': shippingId },
    }),
    ...(returnPolicy && {
      hasMerchantReturnPolicy: { ...returnPolicy, '@id': returnPolicyId },
    }),
  };
  const references: SharedOfferPolicies = {
    ...(shippingDetails && {
      shippingDetails: { '@id': shippingId },
    }),
    ...(returnPolicy && {
      hasMerchantReturnPolicy: { '@id': returnPolicyId },
    }),
  };

  return (variantIndex) => (variantIndex === 0 ? definitions : references);
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
