import { createHmac } from 'node:crypto';
import type { SyntheticMerchant } from './synthetic-merchants';

/** The checkout_sessions columns the DVA payment confirmation reads. */
interface SyntheticDvaSession {
  readonly currency: string;
  readonly id: string;
  readonly merchant_id: string;
  readonly metadata: {
    readonly agentic: {
      readonly dva_account: { readonly account_number: string };
      readonly payment_state: 'payment_pending';
    };
  };
  readonly order_id: string | null;
  readonly session_id: string;
  readonly status: 'processing';
  /** Major units, as the NUMERIC column stores it. */
  readonly total_amount: number;
}

export const SYNTHETIC_DVA_ACCOUNT_NUMBER = '9930000902';

export function buildSyntheticDvaSession(
  merchant: SyntheticMerchant,
  {
    orderId = 'synthetic-order-1',
    totalAmount,
  }: { orderId?: string | null; totalAmount: number }
): SyntheticDvaSession {
  return {
    currency: 'NGN',
    id: 'synthetic-checkout-row-1',
    merchant_id: merchant.context.id,
    metadata: {
      agentic: {
        dva_account: { account_number: SYNTHETIC_DVA_ACCOUNT_NUMBER },
        payment_state: 'payment_pending',
      },
    },
    order_id: orderId,
    session_id: 'synthetic_session_1',
    status: 'processing',
    total_amount: totalAmount,
  };
}

interface PaystackChargeSuccessEvent {
  readonly data: {
    readonly amount: number;
    readonly authorization: {
      readonly receiver_bank_account_number: string;
    };
    readonly currency: string;
    readonly id: number;
    readonly reference: string;
    readonly status: 'success';
  };
  readonly event: 'charge.success';
}

export type SyntheticPaystackOutcomeKind =
  | 'duplicate_webhook'
  | 'paid_exact'
  | 'paid_short'
  | 'timeout';

interface SyntheticPaystackOutcome {
  readonly gatewayReference: string;
  /**
   * True when Baci cannot tell whether the customer paid. Reconcile with the
   * provider; never create a second payment attempt for it.
   */
  readonly indeterminate: boolean;
  readonly kind: SyntheticPaystackOutcomeKind;
  /**
   * What the webhook route derives from Paystack's verify response (kobo
   * divided by 100). Null when verification gave no amount.
   */
  readonly verifiedAmount: { amount: number; currency: string } | null;
  /** Webhook deliveries in arrival order. */
  readonly webhooks: readonly PaystackChargeSuccessEvent[];
}

const GATEWAY_REFERENCE = 'synthetic-paystack-ref-1';

function chargeSuccess(
  session: SyntheticDvaSession,
  amountKobo: number
): PaystackChargeSuccessEvent {
  return {
    data: {
      amount: amountKobo,
      authorization: {
        receiver_bank_account_number:
          session.metadata.agentic.dva_account.account_number,
      },
      currency: session.currency,
      id: 4_000_000_001,
      reference: GATEWAY_REFERENCE,
      status: 'success',
    },
    event: 'charge.success',
  };
}

/**
 * One fake Paystack outcome for a DVA checkout session. A short payment is one
 * kobo below the total, the smallest mismatch the confirmation must reject.
 */
export function buildSyntheticPaystackOutcome(
  kind: SyntheticPaystackOutcomeKind,
  session: SyntheticDvaSession
): SyntheticPaystackOutcome {
  const exactKobo = Math.round(session.total_amount * 100);
  const paidKobo = kind === 'paid_short' ? exactKobo - 1 : exactKobo;
  const event = chargeSuccess(session, paidKobo);
  const verified = { amount: paidKobo / 100, currency: session.currency };
  return {
    gatewayReference: GATEWAY_REFERENCE,
    indeterminate: kind === 'timeout',
    kind,
    verifiedAmount: kind === 'timeout' ? null : verified,
    webhooks: kind === 'duplicate_webhook' ? [event, event] : [event],
  };
}

/** The raw body and `x-paystack-signature` value for a webhook delivery. */
export function signPaystackWebhook(
  event: PaystackChargeSuccessEvent,
  secret: string
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    signature: createHmac('sha512', secret).update(rawBody).digest('hex'),
  };
}
