import type { ImeiRpcClient } from '@/lib/imei-access';
import { errorBody, json } from './route-helpers';

/** Caller must know provider.submit was never reached; ambiguous sends cannot use this. */
export async function refundUnsubmittedPetrockLookup({
  lookupId,
  supabaseAdmin,
}: {
  lookupId: string;
  supabaseAdmin: ImeiRpcClient;
}) {
  // The atomic cancellation is idempotent: a lost refund response may be retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await supabaseAdmin.rpc(
        'cancel_unsubmitted_petrock_imei_lookup',
        {
          p_lookup_id: lookupId,
        }
      );
      if (result.error) throw result.error;
      if (result.data === true) {
        return json(
          {
            ...errorBody({
              code: 'PETROCK_NOT_SUBMITTED',
              error: 'Lookup could not start; your wallet was refunded.',
            }),
            lookupId,
          },
          502
        );
      }
      break;
    } catch {
      // A second call confirms a committed cancellation without duplicating credit.
    }
  }
  return json(
    {
      ...errorBody({
        code: 'IMEI_PAYMENT_RECONCILIATION_REQUIRED',
        error:
          'Wallet refund could not be confirmed. Contact support before retrying.',
      }),
      lookupId,
    },
    503
  );
}
