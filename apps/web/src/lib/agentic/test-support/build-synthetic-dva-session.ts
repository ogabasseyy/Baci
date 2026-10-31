import type { SyntheticMerchant } from './synthetic-merchants';

/** The checkout_sessions columns the DVA payment confirmation reads. */
export interface SyntheticDvaSession {
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
