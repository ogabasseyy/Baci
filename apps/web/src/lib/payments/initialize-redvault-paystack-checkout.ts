import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { initializeTransaction } from '../paystack';
import { createRedvaultPaymentAttemptClient } from './redvault-payment-attempt-client';
import { initializeRedvaultCheckout } from './redvault-payment-initialize';

export function initializeRedvaultPaystackCheckout({
  customerEmail,
  fallbackClient,
  merchantId,
  orderId,
  redirectUrl,
  subaccount,
  userId,
}: {
  customerEmail: string;
  fallbackClient: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  orderId: string;
  redirectUrl: string;
  subaccount: string;
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
        const paystack = await initializeTransaction({
          amount: input.amountKobo,
          callback_url: input.redirectUrl,
          channels: ['card'],
          email: input.customerEmail,
          metadata: {
            ...input.authorizationMetadata,
            merchant_id: merchantId,
            order_id: orderId,
          },
          reference: input.reference,
          subaccount,
        });
        if (!paystack.authorization_url) {
          throw new Error('REDVAULT Paystack checkout URL is missing');
        }
        return { authorizationUrl: paystack.authorization_url };
      },
    },
    redirectUrl,
  });
}
