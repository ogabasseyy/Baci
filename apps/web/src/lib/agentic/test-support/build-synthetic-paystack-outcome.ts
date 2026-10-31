import type { SyntheticDvaSession } from './build-synthetic-dva-session';

export interface PaystackChargeSuccessEvent {
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
