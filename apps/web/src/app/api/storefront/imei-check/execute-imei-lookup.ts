import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { ImeiAccessClient } from '@/lib/imei-access';
import {
  isInsufficientWalletBalanceError,
  readCustomerWalletBalance,
  redeemImeiWalletPayment,
} from '@/lib/imei-lookup-fulfillment';
import { submitPetrockLookup } from './petrock-submission-flow';
import type { prepareImeiProvider } from './prepare-imei-provider';
import {
  type ActiveImeiLookup,
  recoverImeiLookupFailure,
} from './recover-imei-lookup-failure';
import {
  cacheInsufficientBalanceResponse,
  cacheSuccessfulLookup,
  refundAndCacheFailure,
} from './route-cache-helpers';
import {
  errorBody,
  findLookupByIdempotencyKey,
  isUniqueViolation,
  json,
  mapExistingLookup,
} from './route-helpers';

export async function executeImeiLookup({
  customer,
  deviceCategory,
  encryptionKey,
  binding,
  provider,
  serviceTier,
  supabase,
  supabaseAdmin,
  idempotencyKey,
  imeiHash,
  merchantId,
  normalizedImei,
  replayContext,
  request,
  requestedTier,
}: {
  customer: { id: string };
  deviceCategory?: ImeiDeviceCategory;
  supabase: SupabaseClient;
  supabaseAdmin: ImeiAccessClient;
  idempotencyKey: string;
  imeiHash: string;
  merchantId: string;
  normalizedImei: string;
  replayContext: {
    customerId: string;
    deviceCategory?: ImeiDeviceCategory;
    imeiHash: string;
    merchantId: string;
    tier: ImeiServiceTierKey;
  };
  request: NextRequest;
  requestedTier: ImeiServiceTierKey;
} & Exclude<
  Awaited<ReturnType<typeof prepareImeiProvider>>,
  { response: unknown }
>) {
  let activeLookup: ActiveImeiLookup | null = null;
  let debitSucceeded = false;
  try {
    const amount = serviceTier.price;
    const { data: insertedLookup, error: insertError } =
      await supabaseAdmin.insertPending({
        amount_ngn: amount,
        customer_id: customer.id,
        idempotency_key: idempotencyKey,
        imei_hash: imeiHash,
        device_category: deviceCategory ?? null,
        merchant_id: merchantId,
        status: 'pending',
        tier: requestedTier,
      });

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const winningLookup = await findLookupByIdempotencyKey(
          supabaseAdmin,
          idempotencyKey
        );
        if (winningLookup) {
          return mapExistingLookup(winningLookup, replayContext);
        }

        return json(
          errorBody({
            code: 'IDEMPOTENCY_CONFLICT',
            error: 'Idempotency-Key already belongs to another request.',
          }),
          409
        );
      }
      throw new Error(
        `Failed to create IMEI lookup row: ${insertError.message}`
      );
    }

    if (!insertedLookup) throw new Error('IMEI pending insert returned no row');

    activeLookup = {
      amount,
      customerId: customer.id,
      id: String(insertedLookup.id),
      merchantId,
      provider: binding.provider,
    };

    let preflightBalance: number | undefined;
    try {
      preflightBalance = await readCustomerWalletBalance({
        customerId: customer.id,
        merchantId,
        supabase,
      });
    } catch (balanceError) {
      console.error('[IMEI Check] Failed to read preflight wallet balance:', {
        customerId: customer.id,
        error: balanceError,
        merchantId,
      });
    }

    if (binding.provider === 'petrock') {
      try {
        return await submitPetrockLookup({
          amount,
          binding,
          checksIncluded: serviceTier.checksIncluded,
          customerId: customer.id,
          deviceCategory,
          encryptionKey: encryptionKey as string,
          identifier: normalizedImei,
          lookupId: activeLookup.id,
          merchantId,
          onDebitSucceeded: () => {
            debitSucceeded = true;
          },
          origin: request.nextUrl.origin,
          provider,
          supabaseAdmin,
          tierName: serviceTier.name,
        });
      } catch (error) {
        if (
          !isInsufficientWalletBalanceError(
            error as { code?: string; message?: string } | null | undefined
          )
        ) {
          throw error;
        }
        return await cacheInsufficientBalanceResponse({
          amount,
          customerId: customer.id,
          lookupId: activeLookup.id,
          merchantId,
          preflightBalance,
          supabase,
          supabaseAdmin,
        });
      }
    }

    try {
      await redeemImeiWalletPayment({
        amount,
        customerId: customer.id,
        lookupId: activeLookup.id,
        merchantId,
        supabaseAdmin,
      });
      debitSucceeded = true;
    } catch (error) {
      if (
        !isInsufficientWalletBalanceError(
          error as { code?: string; message?: string } | null | undefined
        )
      ) {
        throw error;
      }
      return await cacheInsufficientBalanceResponse({
        amount,
        customerId: customer.id,
        lookupId: activeLookup.id,
        merchantId,
        preflightBalance,
        supabase,
        supabaseAdmin,
      });
    }

    const providerStartedAt = Date.now();
    const providerOutcome = await provider.submit({
      binding,
      checksIncluded: serviceTier.checksIncluded,
      feedbackUrl: '',
      identifier: normalizedImei,
      referenceId: activeLookup.id,
      tierName: serviceTier.name,
    });
    const providerLatencyMs = Date.now() - providerStartedAt;

    if (providerOutcome.kind === 'complete') {
      return await cacheSuccessfulLookup({
        amount,
        customerId: customer.id,
        latencyMs: providerLatencyMs,
        lookupId: activeLookup.id,
        merchantId,
        providerResult: {
          body: providerOutcome.body,
          ok: true,
          rawResponseText: providerOutcome.rawResponseText,
          sickwStatus: providerOutcome.providerStatus,
          status: providerOutcome.status,
        },
        supabaseAdmin,
        tier: requestedTier,
      });
    }

    if (providerOutcome.kind !== 'failure') {
      throw new Error('Sickw unexpectedly returned a non-terminal outcome');
    }

    return await refundAndCacheFailure({
      amount,
      body: providerOutcome.body,
      customerId: customer.id,
      lookupId: activeLookup.id,
      merchantId,
      refundSuccessStatus:
        providerOutcome.refundReason === 'not_found'
          ? 'refunded_not_found'
          : 'refunded_error',
      sickwStatus: providerOutcome.providerStatus,
      status: providerOutcome.status,
      supabaseAdmin,
    });
  } catch (error) {
    console.error('IMEI check error:', error);
    return recoverImeiLookupFailure({
      activeLookup,
      debitSucceeded,
      supabaseAdmin,
    });
  }
}
