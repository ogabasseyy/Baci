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
  serviceClient,
  userId,
}: {
  customerEmail: string;
  fallbackClient: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  redirectUrl: string;
  serviceClient: Pick<SupabaseClient, 'rpc'>;
  userId: string | null;
}) {
  const attemptAdapter = createRedvaultPaymentAttemptClient({
    customerEmail,
    fallbackClient,
    merchantId,
    serviceClient,
    userId,
  });

  return initializeRedvaultCheckout({
    attemptAdapter,
    customerEmail,
    orderId,
    provider: {
      async initialize(input) {
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
          },
          reference: input.reference,
          subaccount: input.paystackSubaccount,
          transaction_charge: input.platformFeeKobo,
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
