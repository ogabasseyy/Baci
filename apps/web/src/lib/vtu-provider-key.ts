/**
 * Which submitted fields are tried, in order, to name the provider key of a
 * bill payment. Routing prefers what the customer saw (the biller name); the
 * commission key follows the provider that will fulfil the purchase.
 */
const BILL_KEY_FIELD_ORDER = {
  routing: ['billerName', 'billerCode', 'billItemIdentifier', 'productCode'],
  monnify: ['billerCode', 'productCode', 'billerName', 'billItemIdentifier'],
  kuda: ['billItemIdentifier', 'productCode', 'billerName', 'billerCode'],
} as const;

interface VtuProviderKeyInput {
  billerCode?: string;
  billerName?: string;
  billItemIdentifier?: string;
  isTelco: boolean;
  normalizedNetworkProvider?: string;
  /** 'routing' picks the provider; a provider name picks its commission key. */
  order: keyof typeof BILL_KEY_FIELD_ORDER;
  productCode?: string;
}

/**
 * The key that names the provider for a purchase: the normalized network for
 * airtime and data, otherwise the first non-blank bill field in the order
 * for `order`. Throws when a bill payment carries none of them.
 */
export function resolveVtuProviderKey({
  isTelco,
  normalizedNetworkProvider,
  order,
  ...fields
}: VtuProviderKeyInput) {
  if (isTelco) {
    return normalizedNetworkProvider;
  }

  const key = BILL_KEY_FIELD_ORDER[order]
    .map((field) => fields[field]?.trim())
    .find(Boolean);

  if (!key) {
    throw new Error('Biller name or provider key is required for bill payment');
  }

  return key;
}
