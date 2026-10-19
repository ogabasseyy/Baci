import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOrderGiglInternalCreditRetainedAmount } from './load-order-gigl-internal-credit-retained-amount';
import { loadOrderGiglSettledRetainedAmount } from './load-order-gigl-settled-retained-amount';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

type GiglBookingPaymentContext = {
  payment_method?: string | null;
  payment_status?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_provider?: string | null;
};

export type AssertGiglCustomerCheckoutPrepaidContext = {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  /** Test injection / preloaded settled retention; skips the settlements read. */
  settledRetainedAmount?: number;
};

const GIGL_CHECKOUT_PAYMENT_METHODS_WITHOUT_RETENTION = new Set([
  'pod',
  'pay_on_delivery',
  'credit_direct',
  'credit-direct',
  'manual',
  'manual_payment',
  'cash',
]);

function normalizePaymentMethod(
  paymentMethod: string | null | undefined
): string {
  return (paymentMethod ?? '').trim().toLowerCase();
}

function parseRetainedShippingAmount(
  value: number | string | null | undefined
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : 0;
}

export function isPayOnDeliveryPaymentMethod(
  paymentMethod: string | null | undefined
): boolean {
  const normalized = normalizePaymentMethod(paymentMethod);
  return normalized === 'pod' || normalized === 'pay_on_delivery';
}

export function isGiglCheckoutPaymentWithoutRetainedShipping(
  paymentMethod: string | null | undefined
): boolean {
  return GIGL_CHECKOUT_PAYMENT_METHODS_WITHOUT_RETENTION.has(
    normalizePaymentMethod(paymentMethod)
  );
}

/**
 * Authoritative prepaid shipping intent: customer_checkout funding with a
 * positive retained amount. Never infer retention from Paystack/Korapay/etc.
 * when shipping_funding_source is null — payment method alone is not proof
 * GIGL shipping was retained at checkout. Null funding is handled as a legacy
 * booking path in assertGiglCustomerCheckoutPrepaid.
 */
export function hasGiglCheckoutShippingRetention(
  order: Pick<
    GiglBookingPaymentContext,
    'shipping_funding_source' | 'shipping_platform_retained_amount'
  >
): boolean {
  if (order.shipping_funding_source !== 'customer_checkout') {
    return false;
  }

  return (
    parseRetainedShippingAmount(order.shipping_platform_retained_amount) > 0
  );
}

function throwPrepaidRequired(): never {
  throw new OrderShipmentBookingError(
    'GIGL shipping must be prepaid at checkout or funded from the merchant wallet before booking.',
    400,
    'GIGL_REQUIRES_PREPAID_OR_WALLET'
  );
}

/**
 * Before customer-checkout GIGL booking, require paid status, retention intent
 * on the order, and completed settlement retention that covers the stamped
 * amount. Order.shipping_platform_retained_amount is stamped at quote time and
 * is not proof Baci holds the tariff.
 */
export async function assertGiglCustomerCheckoutPrepaid(
  order: GiglBookingPaymentContext,
  context?: AssertGiglCustomerCheckoutPrepaidContext
): Promise<void> {
  if (order.shipping_provider !== 'GIGL') {
    return;
  }

  if (order.shipping_funding_source === 'merchant_wallet') {
    return;
  }

  const paymentStatus = (order.payment_status ?? '').trim().toLowerCase();
  const paymentMethod = normalizePaymentMethod(order.payment_method);

  // Legacy GIGL orders created before economics snapshots keep a null funding
  // source. Preserve the prior paid booking path for those rows; only stamped
  // customer_checkout orders require settlement-covered retention below.
  if (order.shipping_funding_source == null) {
    if (
      paymentStatus !== 'paid' ||
      isPayOnDeliveryPaymentMethod(order.payment_method)
    ) {
      throwPrepaidRequired();
    }
    return;
  }

  const hasRetentionIntent = hasGiglCheckoutShippingRetention(order);
  const requiresPrepaidShipping =
    paymentStatus !== 'paid' ||
    isPayOnDeliveryPaymentMethod(order.payment_method) ||
    isGiglCheckoutPaymentWithoutRetainedShipping(paymentMethod) ||
    !hasRetentionIntent;

  if (requiresPrepaidShipping) {
    throwPrepaidRequired();
  }

  const requiredRetained = parseRetainedShippingAmount(
    order.shipping_platform_retained_amount
  );
  let settledRetained: number;
  if (typeof context?.settledRetainedAmount === 'number') {
    settledRetained = context.settledRetainedAmount;
  } else if (context) {
    try {
      const fromSettlements = await loadOrderGiglSettledRetainedAmount(
        context.supabase,
        context.merchantId,
        context.orderId
      );
      // Wallet/savings/store-credit checkouts often have no settlement row;
      // sum completed internal-credit amounts and combine with settlements,
      // never counting more than the stamped tariff as retained.
      const fromInternalCredit =
        fromSettlements >= requiredRetained
          ? 0
          : await loadOrderGiglInternalCreditRetainedAmount(
              context.supabase,
              context.merchantId,
              context.orderId,
              {
                shipping_funding_source: order.shipping_funding_source,
                shipping_platform_retained_amount:
                  order.shipping_platform_retained_amount,
              }
            );
      settledRetained = Math.min(
        requiredRetained,
        (Math.round(fromSettlements * 100) +
          Math.round(fromInternalCredit * 100)) /
          100
      );
    } catch {
      throwPrepaidRequired();
    }
  } else {
    throwPrepaidRequired();
  }

  if (settledRetained < requiredRetained) {
    throwPrepaidRequired();
  }
}
