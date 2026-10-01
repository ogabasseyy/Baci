import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

export type MerchantShippingCharge = {
  chargeId: string;
  chargedAmount: number;
  balanceAfter: number;
  status: string;
};

function row<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function attemptToken(): string {
  return randomBytes(32).toString('hex');
}

async function readInsufficientWalletDetails(
  supabase: SupabaseClient,
  orderId: string,
  quoteId: string
) {
  if (typeof supabase.from !== 'function') return undefined;
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('merchant_id, shipping_fee')
      .eq('id', orderId)
      .maybeSingle();
    if (!order?.merchant_id) return undefined;
    const { data: quote } = await supabase
      .from('shipping_quotes')
      .select('price')
      .eq('id', quoteId)
      .eq('merchant_id', order.merchant_id)
      .maybeSingle();
    const { data: wallet } = await supabase
      .from('merchant_wallets')
      .select('available_balance')
      .eq('merchant_id', order.merchant_id)
      .maybeSingle();
    const chargedAmount = Number(quote?.price ?? order.shipping_fee ?? 0);
    const availableBalance = Number(wallet?.available_balance ?? 0);
    if (!Number.isFinite(chargedAmount) || !Number.isFinite(availableBalance)) {
      return undefined;
    }
    return {
      availableBalance,
      chargedAmount,
      shortfall: Math.max(0, chargedAmount - availableBalance),
    };
  } catch {
    return undefined;
  }
}

export async function reserveMerchantShippingCharge(
  supabase: SupabaseClient,
  orderId: string,
  quoteId: string
): Promise<{ charge: MerchantShippingCharge; token: string }> {
  const token = attemptToken();
  const { data, error } = await supabase.rpc(
    'reserve_merchant_shipping_charge',
    {
      p_order_id: orderId,
      p_quote_id: quoteId,
      p_attempt_token: token,
    }
  );
  if (error) {
    if (error.message?.includes('MERCHANT_WALLET_INSUFFICIENT')) {
      throw new OrderShipmentBookingError(
        'Insufficient merchant wallet balance.',
        409,
        'MERCHANT_WALLET_INSUFFICIENT',
        undefined,
        await readInsufficientWalletDetails(supabase, orderId, quoteId)
      );
    }
    throw new OrderShipmentBookingError(
      'Unable to reserve merchant wallet for shipping.',
      409,
      'MERCHANT_WALLET_RESERVATION_FAILED'
    );
  }
  const charge = row(
    data as
      | (MerchantShippingCharge & {
          charge_id?: string;
          charged_amount?: number;
          balance_after?: number;
        })
      | (MerchantShippingCharge & {
          charge_id?: string;
          charged_amount?: number;
          balance_after?: number;
        })[]
      | null
  );
  if (!charge?.chargeId && !charge?.charge_id) {
    throw new OrderShipmentBookingError(
      'Unable to reserve merchant wallet for shipping.',
      409,
      'MERCHANT_WALLET_RESERVATION_FAILED'
    );
  }
  const normalized = charge;
  return {
    charge: {
      chargeId: normalized.chargeId ?? normalized.charge_id ?? '',
      chargedAmount: Number(
        normalized.chargedAmount ?? normalized.charged_amount ?? 0
      ),
      balanceAfter: Number(
        normalized.balanceAfter ?? normalized.balance_after ?? 0
      ),
      status: normalized.status,
    },
    token,
  };
}

export async function beginMerchantShippingChargeSubmission(
  supabase: SupabaseClient,
  chargeId: string,
  token: string
) {
  const { data, error } = await supabase.rpc(
    'begin_merchant_shipping_charge_submission',
    { p_charge_id: chargeId, p_attempt_token: token }
  );
  if (error)
    throw new OrderShipmentBookingError(
      'Unable to begin shipment submission.',
      500,
      'MERCHANT_WALLET_SUBMISSION_FAILED'
    );
  return typeof data === 'string'
    ? data
    : row(data as string[] | string | null);
}

export async function completeMerchantShippingCharge(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  shipmentId: string
) {
  const { data, error } = await supabase.rpc(
    'complete_merchant_shipping_charge',
    { p_charge_id: chargeId, p_attempt_token: token, p_shipment_id: shipmentId }
  );
  if (error)
    throw new OrderShipmentBookingError(
      'Unable to complete shipment charge.',
      500,
      'MERCHANT_WALLET_COMPLETION_FAILED'
    );
  return typeof data === 'string'
    ? data
    : row(data as string[] | string | null);
}

export async function recoverMerchantShippingChargeForPersistedShipment(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  shipmentId: string
) {
  const { data, error } = await supabase.rpc(
    'recover_merchant_shipping_charge_for_persisted_shipment',
    { p_charge_id: chargeId, p_attempt_token: token, p_shipment_id: shipmentId }
  );
  if (error)
    throw new OrderShipmentBookingError(
      'Unable to recover shipment charge for the persisted booking.',
      500,
      'MERCHANT_WALLET_COMPLETION_FAILED'
    );
  return typeof data === 'string'
    ? data
    : row(data as string[] | string | null);
}

export async function refundMerchantShippingCharge(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  reasonCode: string
) {
  const { error } = await supabase.rpc('refund_merchant_shipping_charge', {
    p_charge_id: chargeId,
    p_attempt_token: token,
    p_reason_code: reasonCode,
  });
  if (error) {
    throw new OrderShipmentBookingError(
      'Unable to refund merchant wallet shipping charge.',
      500,
      'MERCHANT_WALLET_REFUND_FAILED'
    );
  }
}

export async function markMerchantShippingChargeForReconciliation(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  reasonCode: string,
  providerReference?: string
) {
  const { error } = await supabase.rpc(
    'mark_merchant_shipping_charge_for_reconciliation',
    {
      p_charge_id: chargeId,
      p_attempt_token: token,
      p_reason_code: reasonCode,
      p_provider_reference: providerReference ?? null,
    }
  );
  if (error) {
    throw new OrderShipmentBookingError(
      'Unable to mark merchant wallet shipping charge for reconciliation.',
      500,
      'MERCHANT_WALLET_RECONCILIATION_FAILED'
    );
  }
}

export function isAmbiguousShippingBookingError(error: unknown): boolean {
  return (
    error instanceof OrderShipmentBookingError &&
    !shouldReleaseBookingLock(error)
  );
}
