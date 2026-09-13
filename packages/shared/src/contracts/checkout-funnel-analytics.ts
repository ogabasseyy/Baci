import {
  type AnalyticsProperties,
  compactAnalyticsProperties,
} from './ecommerce-analytics';

/**
 * Stable events for the storefront checkout funnel. Keep these names lowercase
 * and immutable so the same funnel can be used across web and mobile.
 */
export const CHECKOUT_FUNNEL_EVENTS = {
  checkoutStarted: 'checkout_started',
  checkoutStepCompleted: 'checkout_step_completed',
  paymentMethodSelected: 'checkout_payment_method_selected',
  orderCreated: 'order_created',
  invoiceGenerated: 'invoice_generated',
  paymentStarted: 'payment_started',
  paymentCompleted: 'payment_completed',
  paymentFailed: 'payment_failed',
} as const;

export type CheckoutFunnelEventName =
  (typeof CHECKOUT_FUNNEL_EVENTS)[keyof typeof CHECKOUT_FUNNEL_EVENTS];

export type CheckoutPaymentIntent =
  | 'pay_now'
  | 'installments'
  | 'proforma_invoice'
  | 'pay_for_me'
  | 'pay_on_delivery';

export interface CheckoutFunnelPropertiesInput {
  channel?: string;
  checkoutStep?: string;
  currency?: string;
  durationMs?: number;
  itemCount?: number;
  orderId?: string;
  orderNumber?: string;
  properties?: AnalyticsProperties;
  paymentIntent?: CheckoutPaymentIntent;
  paymentMethod?: string;
  paymentStatus?: string;
  reason?: string;
  reference?: string;
  source?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  shipping?: number;
  value?: number;
}

/**
 * Returns the one property shape shared by every checkout event. `event_version`
 * makes future migrations explicit, while `app_surface` is stamped by each
 * platform's capture adapter and is intentionally not accepted here.
 */
export function buildCheckoutFunnelProperties(
  input: CheckoutFunnelPropertiesInput
): AnalyticsProperties {
  return compactAnalyticsProperties({
    ...input.properties,
    channel: input.channel,
    checkout_flow: 'storefront',
    checkout_step: input.checkoutStep,
    currency: input.currency || 'NGN',
    duration_ms: input.durationMs,
    event_version: 1,
    item_count: input.itemCount,
    order_id: input.orderId,
    order_number: input.orderNumber,
    payment_intent: input.paymentIntent,
    payment_method: input.paymentMethod,
    payment_status: input.paymentStatus,
    reason: input.reason,
    reference: input.reference,
    source: input.source,
    subtotal: input.subtotal,
    tax: input.tax,
    total: input.total,
    shipping: input.shipping,
    value: input.value ?? input.total,
  });
}

export function getCheckoutPaymentIntent(
  paymentMethod: string
): CheckoutPaymentIntent | undefined {
  switch (paymentMethod) {
    case 'credpal':
    case 'credit_direct':
    case 'klump':
      return 'installments';
    case 'invoice':
      return 'proforma_invoice';
    case 'payforme':
      return 'pay_for_me';
    case 'pod':
    case 'pay_on_delivery':
      return 'pay_on_delivery';
    case 'paystack':
    case 'korapay':
    case 'juicyway':
    case 'bank_transfer':
    case 'paypal':
      return 'pay_now';
    default:
      return undefined;
  }
}
