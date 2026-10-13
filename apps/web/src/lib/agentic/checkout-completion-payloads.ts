import type { calculateCheckoutSession } from '@/lib/agentic/checkout';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import {
  type AgenticMetadata,
  getFulfillmentAmount,
  getSubtotalAmount,
} from '@/lib/agentic/checkout-storage';

interface CheckoutDvaAccount {
  account_name: string;
  account_number: string;
  bank_name: string;
}

interface PaymentSession {
  merchant_id: string;
  session_id: string;
  shipping_address?: unknown;
}

const AGENTIC_ORDER_SOURCE = 'agentic_ai';
const BANK_TRANSFER_PAYMENT_METHOD = 'bank_transfer';
const PAYSTACK_PAYMENT_PROVIDER = 'paystack';
const PAYMENT_PENDING_STATE = 'payment_pending';
const PENDING_STATUS = 'pending';
const PROCESSING_STATUS = 'processing';

export function buildAgenticCheckoutOrderPayload({
  buyer,
  dvaAccount,
  session,
  sessionCalc,
}: {
  buyer: AgenticCheckoutBuyer;
  dvaAccount: CheckoutDvaAccount;
  session: PaymentSession;
  sessionCalc: Awaited<ReturnType<typeof calculateCheckoutSession>>;
}) {
  return {
    merchant_id: session.merchant_id,
    customer_email: buyer.email,
    customer_name: buildBuyerDisplayName(buyer),
    customer_phone: buyer.phone_number,
    items: sessionCalc.lineItems.map((li) => ({
      name: li.item.title || li.item.id || 'Product',
      product_id: li.item.product_id,
      ...(li.item.variant_id ? { variant_id: li.item.variant_id } : {}),
      ...(li.item.variant_attributes
        ? { variant_attributes: li.item.variant_attributes }
        : {}),
      quantity: li.item.quantity,
      price: li.base_amount,
    })),
    subtotal: getSubtotalAmount(sessionCalc.totals),
    shipping_fee: getFulfillmentAmount(sessionCalc.totals),
    payment_method: BANK_TRANSFER_PAYMENT_METHOD,
    payment_status: PENDING_STATUS,
    payment_provider_reference: dvaAccount.account_number,
    shipping_status: PENDING_STATUS,
    shipping_address: session.shipping_address,
    source: AGENTIC_ORDER_SOURCE,
    notes: `Agentic Checkout Session: ${session.session_id} | DVA: ${dvaAccount.bank_name} - ****${getAccountLast4(dvaAccount.account_number)}`,
  };
}

export function buildPaymentPendingSessionUpdate({
  buyer,
  dvaAccount,
  metadata,
  orderId,
}: {
  buyer: AgenticCheckoutBuyer;
  dvaAccount: CheckoutDvaAccount;
  metadata: AgenticMetadata;
  orderId: string;
}) {
  return {
    status: PROCESSING_STATUS,
    order_id: orderId,
    customer_email: buyer.email,
    customer_name: buildBuyerDisplayName(buyer),
    customer_phone: buyer.phone_number,
    payment_method: BANK_TRANSFER_PAYMENT_METHOD,
    payment_provider: PAYSTACK_PAYMENT_PROVIDER,
    payment_reference: dvaAccount.account_number,
    virtual_account_bank: dvaAccount.bank_name,
    virtual_account_name: dvaAccount.account_name,
    virtual_account_number: dvaAccount.account_number,
    metadata: {
      ...metadata,
      agentic: {
        ...(metadata.agentic ?? {}),
        buyer,
        dva_account: dvaAccount,
        payment_state: PAYMENT_PENDING_STATE,
      },
    },
  };
}

export interface AgenticSharedCartBinding {
  cart_id: string;
  checkout_session_id: string;
  checkout_generation: number;
  cart_version: number;
}

/**
 * Reads a prepared shared-cart binding from checkout session metadata.
 * Only a complete binding (session id + generation + reviewed version)
 * submits bound; linkage-only or malformed metadata stays on the
 * legacy path. The order schema revalidates uuids downstream.
 */
export function readAgenticSharedCartBinding(
  metadata: unknown
): AgenticSharedCartBinding | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const agentic = (metadata as Record<string, unknown>).agentic;
  if (typeof agentic !== 'object' || agentic === null) return null;
  const binding = (agentic as Record<string, unknown>).shared_cart;
  if (typeof binding !== 'object' || binding === null) return null;
  const record = binding as Record<string, unknown>;
  if (
    typeof record.cart_id !== 'string' ||
    !record.cart_id ||
    typeof record.checkout_session_id !== 'string' ||
    !record.checkout_session_id ||
    typeof record.checkout_generation !== 'number' ||
    !Number.isInteger(record.checkout_generation) ||
    record.checkout_generation < 1 ||
    typeof record.cart_version !== 'number' ||
    !Number.isInteger(record.cart_version) ||
    record.cart_version < 1
  ) {
    return null;
  }
  return {
    cart_id: record.cart_id,
    cart_version: record.cart_version,
    checkout_generation: record.checkout_generation,
    checkout_session_id: record.checkout_session_id,
  };
}

function buildBuyerDisplayName(buyer: AgenticCheckoutBuyer): string {
  return [buyer.first_name, buyer.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

function getAccountLast4(accountNumber: string | null | undefined): string {
  const value = String(accountNumber ?? '');
  return value.slice(-4);
}
