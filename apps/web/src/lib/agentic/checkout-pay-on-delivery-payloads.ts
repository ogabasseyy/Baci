import { AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY } from '@/config/agentic-payment-methods';
import type { calculateCheckoutSession } from '@/lib/agentic/checkout';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import {
  type AgenticMetadata,
  getFulfillmentAmount,
  getSubtotalAmount,
} from '@/lib/agentic/checkout-storage';

type CheckoutCalculation = Awaited<ReturnType<typeof calculateCheckoutSession>>;

// Re-export under the legacy local name so existing consumers keep working
// without having to be updated to the @/config import path.
export const PAY_ON_DELIVERY_METHOD = AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY;

const AGENTIC_ORDER_SOURCE = 'agentic_ai';
const PENDING_STATUS = 'pending';

export function buildPayOnDeliveryOrderPayload({
  buyer,
  session,
  sessionCalc,
}: {
  buyer: AgenticCheckoutBuyer;
  session: {
    merchant_id: string;
    session_id: string;
    shipping_address?: unknown;
  };
  sessionCalc: CheckoutCalculation;
}) {
  return {
    customer_email: buyer.email,
    customer_name: buildBuyerDisplayName(buyer),
    customer_phone: buyer.phone_number,
    items: sessionCalc.lineItems.map((lineItem) => ({
      name: lineItem.item.title || lineItem.item.id || 'Product',
      product_id: lineItem.item.product_id,
      quantity: lineItem.item.quantity,
      // The orders API prices each item as a unit price multiplied
      // by quantity; base_amount is the line total, so divide it
      // back out and forward the purchased condition lane.
      price: lineItem.base_amount / lineItem.item.quantity,
      ...(lineItem.item.condition
        ? { condition: lineItem.item.condition }
        : {}),
      ...(lineItem.item.variant_id
        ? { variant_id: lineItem.item.variant_id }
        : {}),
      ...(lineItem.item.variant_attributes
        ? { variant_attributes: lineItem.item.variant_attributes }
        : {}),
    })),
    merchant_id: session.merchant_id,
    notes: `Agentic Checkout Session: ${session.session_id} | Pay on delivery`,
    payment_method: PAY_ON_DELIVERY_METHOD,
    payment_status: PENDING_STATUS,
    shipping_address: session.shipping_address,
    shipping_fee: getFulfillmentAmount(sessionCalc.totals),
    shipping_status: PENDING_STATUS,
    source: AGENTIC_ORDER_SOURCE,
    subtotal: getSubtotalAmount(sessionCalc.totals),
  };
}

export function buildPayOnDeliveryCompletedSessionUpdate({
  buyer,
  metadata,
  orderId,
}: {
  buyer: AgenticCheckoutBuyer;
  metadata: AgenticMetadata;
  orderId: string;
}) {
  const agentic = buildCompletedPayOnDeliveryMetadata(metadata);

  return {
    customer_email: buyer.email,
    customer_name: buildBuyerDisplayName(buyer),
    customer_phone: buyer.phone_number,
    metadata: {
      ...metadata,
      agentic: {
        ...agentic,
        buyer,
        payment_method: PAY_ON_DELIVERY_METHOD,
        payment_state: 'pay_on_delivery_pending',
      },
    },
    order_id: orderId,
    payment_method: PAY_ON_DELIVERY_METHOD,
    payment_provider: null,
    payment_reference: null,
    status: 'completed',
    virtual_account_bank: null,
    virtual_account_name: null,
    virtual_account_number: null,
  };
}

export function buildPayOnDeliveryCheckoutResponse({
  buyer,
  orderId,
  session,
  sessionCalc,
}: {
  buyer: AgenticCheckoutBuyer;
  orderId: string;
  session: { currency: string; session_id: string; shipping_address?: unknown };
  sessionCalc: CheckoutCalculation;
}) {
  return {
    buyer,
    currency: session.currency.toLowerCase(),
    id: session.session_id,
    line_items: sessionCalc.lineItems,
    links: [],
    messages: [
      {
        code: 'pay_on_delivery_pending',
        content:
          'Order confirmed. Payment will be collected when the order is delivered.',
        content_type: 'plain',
        type: 'info',
      },
    ],
    order: {
      id: orderId,
      status: 'payment_pending',
    },
    order_id: orderId,
    payment_details: {
      message: 'Payment will be collected on delivery.',
      type: PAY_ON_DELIVERY_METHOD,
    },
    shipping_address: session.shipping_address,
    status: 'completed',
    totals: sessionCalc.totals,
  };
}

function buildBuyerDisplayName(buyer: AgenticCheckoutBuyer): string {
  return [buyer.first_name, buyer.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function buildCompletedPayOnDeliveryMetadata(metadata: AgenticMetadata) {
  const agentic = { ...(metadata.agentic ?? {}) };
  delete agentic.finalization_claim;
  delete agentic.finalization_error;
  delete agentic.finalization_order_id;
  delete agentic.finalization_updated_at;

  return agentic;
}
