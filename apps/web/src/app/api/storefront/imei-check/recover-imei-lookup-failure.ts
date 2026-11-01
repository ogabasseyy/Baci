import type { ImeiAccessClient } from '@/lib/imei-access';
import { markPetrockSubmissionUnknown } from '@/lib/imei-providers/petrock/petrock-lookup-state';
import { pendingPetrockResponse } from './petrock-submission-flow';
import { refundUnsubmittedPetrockLookup } from './refund-unsubmitted-petrock-lookup';
import {
  cacheLookupResponse,
  refundAndCacheFailure,
} from './route-cache-helpers';
import { errorBody, json } from './route-helpers';

export interface ActiveImeiLookup {
  amount: number;
  customerId: string;
  id: string;
  merchantId: string;
  provider: 'petrock' | 'sickw';
}

export async function recoverImeiLookupFailure({
  activeLookup,
  debitSucceeded,
  supabaseAdmin,
}: {
  activeLookup: ActiveImeiLookup | null;
  debitSucceeded: boolean;
  supabaseAdmin: ImeiAccessClient;
}): Promise<Response> {
  if (!debitSucceeded && activeLookup) {
    // A transport failure is not proof that the transaction rolled back.
    // Never finalize or delete an allegedly uncharged lookup before reading
    // the durable, scope-checked ledger through the same server boundary.
    try {
      const payment = await supabaseAdmin.readPaymentState(activeLookup.id);
      if (
        payment.error ||
        !payment.data ||
        (!payment.data.debited && payment.data.refunded)
      ) {
        throw new Error('IMEI payment outcome could not be confirmed');
      }
      if (payment.data.debited) {
        // No provider call occurred before the lost debit response. Cancel
        // Petrock's write-ahead intent atomically, including an active poll lease.
        if (activeLookup.provider === 'petrock') {
          return refundUnsubmittedPetrockLookup({
            lookupId: activeLookup.id,
            supabaseAdmin,
          });
        }
        return recoverImeiLookupFailure({
          activeLookup,
          debitSucceeded: true,
          supabaseAdmin,
        });
      }
    } catch {
      return json(
        errorBody({
          code: 'IMEI_PAYMENT_RECONCILIATION_REQUIRED',
          error:
            'Wallet payment could not be confirmed. Contact support before retrying.',
        }),
        503
      );
    }
  }

  if (!debitSucceeded && activeLookup) {
    const body = errorBody({
      code: 'INTERNAL_ERROR',
      error: 'Internal server error',
    });

    try {
      await cacheLookupResponse({
        body,
        lookupId: activeLookup.id,
        sickwStatus: 'wallet_debit_error',
        status: 500,
        supabaseAdmin,
        terminalStatus: 'failed_error',
      });
    } catch (cacheError) {
      console.error('[IMEI Check] Failed to cache debit failure:', {
        error: cacheError,
        lookupId: activeLookup.id,
        merchantId: activeLookup.merchantId,
      });
      const { error: deleteError } = await supabaseAdmin.deletePending(
        activeLookup.id
      );

      if (deleteError) {
        console.error(
          '[IMEI Check] Failed to remove uncharged pending lookup after debit failure:',
          {
            error: deleteError,
            lookupId: activeLookup.id,
            merchantId: activeLookup.merchantId,
          }
        );
        return json(
          errorBody({
            code: 'DEBIT_FAILURE_STATE_SAVE_FAILED',
            error:
              'Wallet debit failed and lookup state could not be finalized. Contact support before retrying.',
          }),
          500
        );
      }
    }

    return json(body, 500);
  }

  if (debitSucceeded && activeLookup?.provider === 'petrock') {
    try {
      await markPetrockSubmissionUnknown({
        lookupId: activeLookup.id,
        providerStatus: 'route_unexpected_error',
        supabaseAdmin,
      });
    } catch (stateError) {
      console.error(
        '[IMEI Check] Failed to classify unexpected Petrock error',
        { lookupId: activeLookup.id, stateError }
      );
    }
    return pendingPetrockResponse(activeLookup.id);
  }

  if (debitSucceeded && activeLookup) {
    return await refundAndCacheFailure({
      amount: activeLookup.amount,
      body: errorBody({
        code: 'SICKW_UNAVAILABLE',
        error: 'Lookup failed; your wallet was refunded.',
      }),
      customerId: activeLookup.customerId,
      lookupId: activeLookup.id,
      merchantId: activeLookup.merchantId,
      refundSuccessStatus: 'refunded_error',
      sickwStatus: 'unexpected_error',
      status: 502,
      supabaseAdmin,
    });
  }

  return json(
    errorBody({ code: 'INTERNAL_ERROR', error: 'Internal server error' }),
    500
  );
}
