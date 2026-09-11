type IdempotencyItem = {
  assurance_fee?: number;
  condition?: string;
  has_assurance?: boolean;
  price: number;
  product_id?: string;
  productId?: string;
  quantity: number;
  variant_id?: string;
  variantId?: string;
  variant_attributes?: Record<string, string>;
  variantAttributes?: Record<string, string>;
  variant_name?: string;
  variantName?: string;
};

export type OrderIdempotencyPayloadInput = {
  airport_type?: string | null;
  customer_email: string;
  customer_name: string;
  customer_phone?: string | null;
  delivery_method?: string | null;
  discount_amount?: number;
  discount_code?: string | null;
  gift_wrapping_fee?: number;
  items: readonly IdempotencyItem[];
  merchant_id: string;
  payment_method?: string | null;
  savings_amount?: number | null;
  savings_goal_id?: string | null;
  selected_quote_id?: string | null;
  shipping_address?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  shipping_fee?: number;
  shipping_provider?: string | null;
  shipping_rate_id?: string | null;
  tax_amount?: number;
  use_savings_credit?: boolean;
  use_wallet_credit?: boolean;
  wallet_amount?: number;
};

function compareCodePoints(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeAttributes(
  attributes: Record<string, string> | null | undefined
) {
  if (!attributes) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [normalizeText(key), normalizeText(value)])
      .sort(([left], [right]) => compareCodePoints(left, right))
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeItems(items: readonly IdempotencyItem[]) {
  return items
    .map((item) => ({
      assurance_fee: normalizeNumber(item.assurance_fee),
      condition: normalizeText(item.condition),
      has_assurance: Boolean(item.has_assurance),
      price: normalizeNumber(item.price),
      product_id: normalizeText(item.product_id ?? item.productId),
      quantity: normalizeNumber(item.quantity),
      variant_attributes: normalizeAttributes(
        item.variant_attributes ?? item.variantAttributes
      ),
      variant_id: normalizeText(item.variant_id ?? item.variantId),
      variant_name: normalizeText(item.variant_name ?? item.variantName),
    }))
    .sort((left, right) => {
      const productComparison = compareCodePoints(
        left.product_id,
        right.product_id
      );
      if (productComparison !== 0) {
        return productComparison;
      }

      const variantComparison = compareCodePoints(
        left.variant_id,
        right.variant_id
      );
      if (variantComparison !== 0) {
        return variantComparison;
      }

      const variantNameComparison = compareCodePoints(
        left.variant_name,
        right.variant_name
      );
      if (variantNameComparison !== 0) {
        return variantNameComparison;
      }

      const conditionComparison = compareCodePoints(
        left.condition,
        right.condition
      );
      if (conditionComparison !== 0) {
        return conditionComparison;
      }

      if (left.quantity !== right.quantity) {
        return left.quantity - right.quantity;
      }

      if (left.price !== right.price) {
        return left.price - right.price;
      }

      if (left.assurance_fee !== right.assurance_fee) {
        return left.assurance_fee - right.assurance_fee;
      }

      if (left.has_assurance !== right.has_assurance) {
        return left.has_assurance ? 1 : -1;
      }

      return compareCodePoints(
        stableStringify(left.variant_attributes),
        stableStringify(right.variant_attributes)
      );
    });
}

export function buildOrderIdempotencyPayload(
  input: OrderIdempotencyPayloadInput
) {
  return {
    // JSON.stringify preserves insertion order, so keep hash-significant keys
    // alphabetical to prevent accidental changes during maintenance.
    airport_type: normalizeText(input.airport_type) || undefined,
    customer_email: normalizeText(input.customer_email),
    customer_name: normalizeText(input.customer_name),
    customer_phone: normalizeText(input.customer_phone),
    delivery_method: normalizeText(input.delivery_method) || undefined,
    discount_amount: normalizeNumber(input.discount_amount),
    discount_code: normalizeText(input.discount_code) || null,
    gift_wrapping_fee: normalizeNumber(input.gift_wrapping_fee),
    items: normalizeItems(input.items),
    merchant_id: normalizeText(input.merchant_id),
    savings_amount: normalizeNumber(input.savings_amount),
    savings_goal_id: normalizeText(input.savings_goal_id) || null,
    selected_quote_id: normalizeText(input.selected_quote_id) || null,
    shipping_address: {
      address: normalizeText(input.shipping_address?.address),
      city: normalizeText(input.shipping_address?.city),
      state: normalizeText(input.shipping_address?.state),
    },
    shipping_fee: normalizeNumber(input.shipping_fee),
    shipping_provider: normalizeText(input.shipping_provider),
    // Merchant-rate orders null shipping_provider/selected_quote_id, so the rate
    // id is the only distinguishing field between two same-priced merchant rates
    // (e.g. two same-fee pickup locations). Omit it when empty (undefined, so
    // JSON.stringify drops the key entirely) to keep the hash byte-identical for
    // carrier-quote, pickup/airport, and mobile checkouts that never send it.
    shipping_rate_id: normalizeText(input.shipping_rate_id) || undefined,
    tax_amount: normalizeNumber(input.tax_amount),
    use_savings_credit: Boolean(input.use_savings_credit),
    use_wallet_credit: Boolean(input.use_wallet_credit),
    wallet_amount: normalizeNumber(input.wallet_amount),
  };
}
