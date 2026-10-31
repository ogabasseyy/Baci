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
 * both the HTML and the RSC payload.
 * @see https://developers.google.com/search/docs/appearance/structured-data/product-variants
 */
export function buildSharedOfferPolicies(
  productUrl: URL | undefined,
  shippingDetails: OfferShippingDetails,
  returnPolicy: MerchantReturnPolicy
): (variantIndex: number) => SharedOfferPolicies {
  const base = productUrl ? `${productUrl.origin}${productUrl.pathname}` : '';
  const shippingId = `${base}#shipping-policy`;
  const returnPolicyId = `${base}#return-policy`;

  const definitions: SharedOfferPolicies = {
    shippingDetails: { '@id': shippingId, ...shippingDetails },
    hasMerchantReturnPolicy: { '@id': returnPolicyId, ...returnPolicy },
  };
  const references: SharedOfferPolicies = {
    shippingDetails: { '@id': shippingId },
    hasMerchantReturnPolicy: { '@id': returnPolicyId },
  };

  return (variantIndex) => (variantIndex === 0 ? definitions : references);
}
