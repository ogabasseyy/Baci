interface TransactionDiscountLineKeyInput {
  condition?: string | null;
  productId: string;
  variantAttributes?: Record<string, string> | null;
  variantId: string | null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * Builds a deterministic identity from fields that the storefront order RPC
 * copies into each order item. It disambiguates duplicate product/variant
 * lines without depending on the RPC's generated line-id sequence.
 */
export function buildTransactionDiscountLineKey({
  condition,
  productId,
  variantAttributes,
  variantId,
}: TransactionDiscountLineKeyInput): string {
  return stableStringify([
    productId,
    variantId,
    condition ?? null,
    variantAttributes ?? {},
  ]);
}
