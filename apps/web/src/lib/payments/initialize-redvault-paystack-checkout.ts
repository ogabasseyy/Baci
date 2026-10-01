import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { initializeTransaction, verifyTransaction } from '../paystack';
import { createRedvaultPaymentAttemptClient } from './redvault-payment-attempt-client';
import { initializeRedvaultCheckout } from './redvault-payment-initialize';

export function initializeRedvaultPaystackCheckout({
  customerEmail,
  fallbackClient,
  merchantId,
  orderId,
  redirectUrl,
  userId,
}: {
  customerEmail: string;
  fallbackClient: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  redirectUrl: string;
  userId: string | null;
}) {
  const attemptAdapter = createRedvaultPaymentAttemptClient({
    customerEmail,
    fallbackClient,
    merchantId,
    userId,
  });

  return initializeRedvaultCheckout({
    attemptAdapter,
    customerEmail,
    orderId,
    provider: {
      async initialize(input) {
        // The split collects the base platform fee plus the frozen GIGL
        // retained-shipping snapshot: settlement books both, so the
        // provider charge must match or the ledger records money the
        // platform never collected.
        if (
          !Number.isSafeInteger(input.retainedShippingKobo) ||
          input.retainedShippingKobo < 0 ||
          input.platformFeeKobo + input.retainedShippingKobo > input.amountKobo
        ) {
          throw new Error('REDVAULT split retention is invalid');
        }
        const transactionCharge =
          input.platformFeeKobo + input.retainedShippingKobo;
        const paystack = await initializeTransaction({
          amount: input.amountKobo,
          callback_url: input.redirectUrl,
          channels: ['card'],
          email: input.customerEmail,
          metadata: {
            ...input.authorizationMetadata,
            merchant_id: merchantId,
            order_id: orderId,
            platform_fee_kobo: input.platformFeeKobo,
            retained_shipping_kobo: input.retainedShippingKobo,
          },
          reference: input.reference,
          subaccount: input.paystackSubaccount,
          transaction_charge: transactionCharge,
          bearer: 'account',
        });
        if (!paystack.authorization_url) {
          throw new Error('REDVAULT Paystack checkout URL is missing');
        }
        return { authorizationUrl: paystack.authorization_url };
      },
      async probeInitialization({ reference }) {
        const verification = await verifyTransaction(reference);
        if (!verification.success) {
          // Only a confirmed-missing provider transaction is safe to
          // initialize again; any other failure stays ambiguous so the
          // stale claim is held for reconciliation instead of reissued.
          return verification.code === 'HTTP_404'
            ? { status: 'not_found' as const }
            : { status: 'unknown' as const };
        }
        return verification.data.status === 'success'
          ? { status: 'paid' as const }
          : { status: 'unpaid' as const };
      },
    },
    redirectUrl,
  });
}
