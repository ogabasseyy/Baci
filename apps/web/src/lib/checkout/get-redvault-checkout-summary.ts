import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

export type RedvaultCheckoutSummary = {
  order: {
    currency: string;
    id: string;
    payment_method: 'uba_redvault';
    payment_status: string;
    total: number;
    tracking_token: string | null;
  };
  quote: {
    discount_kobo: number;
    assurance_fee_kobo: number;
    eligible_subtotal_kobo: number;
    gift_wrapping_kobo: number;
    ineligible_subtotal_kobo: number;
    mixed_basket: boolean;
    payable_kobo: number;
    product_subtotal_kobo: number;
    shipping_kobo: number;
    tax_kobo: number;
  };
};

type CheckoutSummaryRow = {
  currency: unknown;
  discount_kobo: unknown;
  assurance_fee_kobo: unknown;
  eligible_subtotal_kobo: unknown;
  gift_wrapping_kobo: unknown;
  ineligible_subtotal_kobo: unknown;
  mixed_basket: unknown;
  order_id: unknown;
  payment_method: unknown;
  payment_status: unknown;
  payable_kobo: unknown;
  product_subtotal_kobo: unknown;
  shipping_kobo: unknown;
  tax_kobo: unknown;
  total: unknown;
  tracking_token: unknown;
};

function firstRow(value: unknown): CheckoutSummaryRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as CheckoutSummaryRow) : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[0-9]+(?:\.[0-9]{1,2}0*)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function koboValue(value: unknown): number | null {
  if (typeof value === 'string' && !/^[0-9]+$/.test(value)) return null;
  return numberValue(value);
}

export async function getRedvaultCheckoutSummary({
  client,
  orderId,
}: {
  client: SupabaseClient;
  orderId: string;
}): Promise<RedvaultCheckoutSummary> {
  const { data, error } = await client.rpc(
    'get_storefront_redvault_checkout_summary' as never,
    { p_order_id: orderId } as never
  );
  const row = firstRow(data);
  const total = row ? numberValue(row.total) : null;
  const quoteValues = row
    ? [
        row.product_subtotal_kobo,
        row.eligible_subtotal_kobo,
        row.ineligible_subtotal_kobo,
        row.discount_kobo,
        row.assurance_fee_kobo,
        row.tax_kobo,
        row.shipping_kobo,
        row.gift_wrapping_kobo,
        row.payable_kobo,
      ].map(koboValue)
    : [];

  if (
    error ||
    !row ||
    row.order_id !== orderId ||
    row.payment_method !== 'uba_redvault' ||
    typeof row.payment_status !== 'string' ||
    typeof row.currency !== 'string' ||
    (row.tracking_token !== null && typeof row.tracking_token !== 'string') ||
    typeof row.mixed_basket !== 'boolean' ||
    total === null ||
    total < 0 ||
    quoteValues.some(
      (value) => value === null || !Number.isSafeInteger(value) || value < 0
    )
  ) {
    throw new Error(error?.message ?? 'redvault_checkout_summary_invalid');
  }

  const [
    productSubtotalKobo,
    eligibleSubtotalKobo,
    ineligibleSubtotalKobo,
    discountKobo,
    assuranceFeeKobo,
    taxKobo,
    shippingKobo,
    giftWrappingKobo,
    payableKobo,
  ] = quoteValues as number[];

  if (
    BigInt(productSubtotalKobo) !==
      BigInt(eligibleSubtotalKobo) + BigInt(ineligibleSubtotalKobo) ||
    discountKobo > eligibleSubtotalKobo ||
    row.mixed_basket !== ineligibleSubtotalKobo > 0 ||
    total !== payableKobo / 100 ||
    BigInt(payableKobo) !==
      BigInt(productSubtotalKobo) -
        BigInt(discountKobo) +
        BigInt(assuranceFeeKobo) +
        BigInt(taxKobo) +
        BigInt(shippingKobo) +
        BigInt(giftWrappingKobo)
  ) {
    throw new Error('redvault_checkout_summary_invalid');
  }

  return {
    order: {
      id: orderId,
      total,
      currency: row.currency,
      tracking_token: row.tracking_token,
      payment_method: 'uba_redvault',
      payment_status: row.payment_status,
    },
    quote: {
      product_subtotal_kobo: productSubtotalKobo,
      eligible_subtotal_kobo: eligibleSubtotalKobo,
      ineligible_subtotal_kobo: ineligibleSubtotalKobo,
      discount_kobo: discountKobo,
      assurance_fee_kobo: assuranceFeeKobo,
      tax_kobo: taxKobo,
      shipping_kobo: shippingKobo,
      gift_wrapping_kobo: giftWrappingKobo,
      payable_kobo: payableKobo,
      mixed_basket: row.mixed_basket,
    },
  };
}
