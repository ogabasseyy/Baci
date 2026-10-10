export type AgenticTaxLinePriceVariant = {
  price_override?: number | string | null;
  product_id?: string | null;
} | null;

export type AgenticTaxLinePriceProduct = {
  price?: number | string | null;
};

export type AgenticTaxLinePriceItem = {
  offer_id?: string | null;
  product_id?: string;
  variant_id?: string | null;
};

/**
 * Resolves the taxable unit price for one order line, mirroring the order
 * RPC precedence: variant override, then live offer, then parent base
 * price. Returns null when the resolved price is not a positive finite
 * number so the caller skips the line. Variant and offer matches are both
 * pinned to the line's own product (the RPC's JOINs enforce the same), so
 * cross-product ids fall through instead of spoofing the basis.
 */
export function resolveAgenticTaxLinePrice({
  candidateVariant,
  item,
  offerPrices,
  product,
}: {
  candidateVariant: AgenticTaxLinePriceVariant | undefined;
  item: AgenticTaxLinePriceItem;
  offerPrices?: Map<string, number>;
  product: AgenticTaxLinePriceProduct;
}): number | null {
  // High finding (PR #1622 review): variant must belong to the
  // SAME product the order line claims. The RPC's LEFT JOIN
  // (`v.product_id = p.id`) enforces this and falls back to base
  // price for mismatched variant_ids.
  const variant =
    candidateVariant && candidateVariant.product_id === item.product_id
      ? candidateVariant
      : null;
  // Mirror the RPC precedence: the key pins the offer to this line's
  // product, so a cross-product offer_id falls through to the parent
  // price (the route rejects the mismatch before the RPC runs).
  const offerPrice =
    item.offer_id && item.product_id
      ? offerPrices?.get(`${item.product_id}::${item.offer_id}`)
      : undefined;
  const priceRaw = variant?.price_override ?? offerPrice ?? product.price ?? 0;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
}
