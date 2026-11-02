import type { MerchantReturnPolicy, OfferShippingDetails } from 'schema-dts';

type NodeReference = { '@id': string };

export interface SharedOfferPolicies {
  shippingDetails: OfferShippingDetails | NodeReference;
  hasMerchantReturnPolicy: MerchantReturnPolicy | NodeReference;
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
  shippingDetails: OfferShippingDetails,
  returnPolicy: MerchantReturnPolicy
): (variantIndex: number) => SharedOfferPolicies {
  const prefix = productUrl
    ? `${productUrl.origin}${productUrl.pathname}#`
    : `#${encodeURIComponent(productGroupId)}-`;
  const shippingId = `${prefix}shipping-policy`;
  const returnPolicyId = `${prefix}return-policy`;

  const definitions: SharedOfferPolicies = {
    shippingDetails: { ...shippingDetails, '@id': shippingId },
    hasMerchantReturnPolicy: { ...returnPolicy, '@id': returnPolicyId },
  };
  const references: SharedOfferPolicies = {
    shippingDetails: { '@id': shippingId },
    hasMerchantReturnPolicy: { '@id': returnPolicyId },
  };

  return (variantIndex) => (variantIndex === 0 ? definitions : references);
}
