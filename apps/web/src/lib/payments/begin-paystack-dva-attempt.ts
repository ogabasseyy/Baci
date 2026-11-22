import 'server-only';

import { logger } from '@/lib/logger';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';
import { paystackDvaAttemptReceiptSchema } from '@/schemas/paystack-dva-attempt';

/** Only the payment route can claim an attempt after checking order and fees. */
export async function beginPaystackDvaAttempt(input: {
  amountKobo: number;
  customerEmail: string;
  merchantId: string;
  orderId: string;
  reference: string;
  trackingToken?: string;
}) {
  try {
    const issuedAt = Math.floor(Date.now() / 1000);
    const client: {
      rpc(
        name: 'begin_chat_paystack_dva_attempt',
        args: { p_tracking_token: string }
      ): PromiseLike<{ data: unknown; error: unknown }>;
    } = createScopedClient(
      signScopedSupabaseJwt({
        aud: 'authenticated',
        exp: issuedAt + 60,
        iat: issuedAt,
        role: 'authenticated',
        paystack_dva_attempt: {
          amount_kobo: input.amountKobo,
          customer_email: input.customerEmail.trim().toLowerCase(),
          merchant_id: input.merchantId,
          order_id: input.orderId,
          reference: input.reference,
        },
      })
    );
    const result = await client.rpc('begin_chat_paystack_dva_attempt', {
      p_tracking_token: input.trackingToken ?? '',
    });
    if (!result.error) {
      const parsed = paystackDvaAttemptReceiptSchema.safeParse(result.data);
      if (parsed.success) return parsed.data;
    }
    logger.error({
      message: 'Chat bank transfer attempt is unavailable',
      reason: result.error ? 'rpc_error' : 'invalid_receipt',
    });
  } catch {
    logger.error({
      message: 'Chat bank transfer attempt is unavailable',
      reason: 'request_exception',
    });
  }
  return { kind: 'unavailable' } as const;
}
