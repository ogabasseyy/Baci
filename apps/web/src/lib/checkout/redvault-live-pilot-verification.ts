import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { getRedvaultCheckoutSummary } from './get-redvault-checkout-summary';
import {
  getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID,
} from './redvault-live-pilot';

export type RedvaultLivePilotRejection = {
  message: string;
  code: 'REDVAULT_UNAVAILABLE' | 'ORDER_AMOUNT_LOOKUP_FAILED';
  status: 409 | 500;
};

export type RedvaultLivePilotVerification =
  | { ok: true }
  | { ok: false; rejection: RedvaultLivePilotRejection };

const UNAVAILABLE: RedvaultLivePilotRejection = {
  message: 'REDVAULT payment is not available',
  code: 'REDVAULT_UNAVAILABLE',
  status: 409,
};

/**
 * Verifies that a private-live-pilot initialization matches the exact
 * controlled-test snapshot: pilot user, pilot merchant, NGN currency, the
 * pinned NGN 100 / NGN 5 quote with no fees, extras, or mixed basket, and a
 * payable DERIVED from the normal tax calculation (subtotal - discount +
 * recomputed quote tax) — never a hard-coded total. The tax VALUE's
 * genuineness is enforced at order creation (validateRedvaultLivePilotOrder
 * derives it from the quote's VAT rate); here the derived payable/total
 * equality keeps a drifted persisted total (tax misconfig, tampering) out
 * of the charge path.
 */
export async function verifyRedvaultLivePilotSnapshot({
  client,
  orderId,
  userId,
  merchantId,
}: {
  client: SupabaseClient;
  orderId: string;
  userId: string | null | undefined;
  merchantId: string;
}): Promise<RedvaultLivePilotVerification> {
  try {
    const summary = await getRedvaultCheckoutSummary({ client, orderId });
    const pilot = getRedvaultLivePilotPolicy();
    // tax_kobo is validated as a non-negative safe integer by the summary
    // helper; the expected payable derives from the pinned basket inputs
    // plus the recomputed tax (fees all pinned to zero below).
    const expectedPayableKobo = 10_000 - 500 + summary.quote.tax_kobo;
    const exactPilotSnapshot = Boolean(
      pilot &&
        userId === REDVAULT_PILOT_USER_ID &&
        merchantId === pilot.merchantId &&
        summary.order.currency.toUpperCase() === 'NGN' &&
        summary.quote.product_subtotal_kobo === 10_000 &&
        summary.quote.eligible_subtotal_kobo === 10_000 &&
        summary.quote.ineligible_subtotal_kobo === 0 &&
        summary.quote.discount_kobo === 500 &&
        summary.quote.assurance_fee_kobo === 0 &&
        summary.quote.shipping_kobo === 0 &&
        summary.quote.gift_wrapping_kobo === 0 &&
        summary.quote.payable_kobo === expectedPayableKobo &&
        summary.order.total === expectedPayableKobo / 100 &&
        summary.quote.mixed_basket === false
    );
    if (!exactPilotSnapshot) {
      return { ok: false, rejection: UNAVAILABLE };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      rejection: {
        message: 'Unable to verify REDVAULT order',
        code: 'ORDER_AMOUNT_LOOKUP_FAILED',
        status: 500,
      },
    };
  }
}

/**
 * Verifies that a private-live-pilot initialization carries no wallet or
 * savings funding: the controlled test is a pure card charge.
 */
export function verifyRedvaultLivePilotFunding({
  walletAmountUsed,
  savingsAmountUsed,
}: {
  walletAmountUsed: number;
  savingsAmountUsed: number;
}): RedvaultLivePilotVerification {
  if (walletAmountUsed !== 0 || savingsAmountUsed !== 0) {
    return { ok: false, rejection: UNAVAILABLE };
  }
  return { ok: true };
}
