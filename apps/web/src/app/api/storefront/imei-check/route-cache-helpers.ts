import type { ImeiServiceTierKey } from '@baci/shared/imei';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichImeiDeviceResult } from '@/lib/imei-device-catalog';
import {
  hashProviderResponse,
  type ImeiLookupErrorBody,
  type ImeiLookupResponseBody,
  readCustomerWalletBalance,
  refundImeiWalletPayment,
  type SickwLookupResult,
} from '@/lib/imei-lookup-fulfillment';
import type { createAdminClient } from '@/lib/supabase/admin';
import { errorBody, type ImeiLookupStatus, json } from './route-helpers';

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

export async function cacheLookupResponse({
  body,
  lookupId,
  responseHash,
  sickwStatus,
  status,
  supabaseAdmin,
  terminalStatus,
}: {
  body: ImeiLookupResponseBody;
  lookupId: string;
  responseHash?: string;
  sickwStatus?: string;
  status: number;
  supabaseAdmin: AdminSupabaseClient;
  terminalStatus: ImeiLookupStatus;
}) {
  const { error } = await supabaseAdmin
    .from('imei_lookups')
    .update({
      cached_response: body,
      cached_status: status,
      ...(responseHash ? { response_hash: responseHash } : {}),
      ...(sickwStatus ? { sickw_status: sickwStatus } : {}),
      status: terminalStatus,
    })
    .eq('id', lookupId)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to cache IMEI lookup response: ${error.message}`);
  }
}

export async function refundAndCacheFailure({
  amount,
  body,
  customerId,
  lookupId,
  merchantId,
  refundFailureStatus = 'refund_pending',
  refundSuccessStatus,
  sickwStatus,
  status,
  supabaseAdmin,
}: {
  amount: number;
  body: ImeiLookupErrorBody;
  customerId: string;
  lookupId: string;
  merchantId: string;
  refundFailureStatus?: ImeiLookupStatus;
  refundSuccessStatus: ImeiLookupStatus;
  sickwStatus?: string;
  status: number;
  supabaseAdmin: AdminSupabaseClient;
}) {
  const terminalBody = { ...body, status: 'error' as const };
  try {
    await refundImeiWalletPayment({
      amount,
      customerId,
      lookupId,
      merchantId,
      supabaseAdmin,
    });
  } catch (error) {
    console.error('[IMEI Check] Wallet refund failed:', {
      amount,
      customerId,
      error,
      lookupId,
      merchantId,
    });
    const refundPendingBody = errorBody({
      code: 'REFUND_PENDING',
      error:
        'Lookup failed; your refund is pending. We will credit you within 24h.',
    });
    try {
      await cacheLookupResponse({
        body: refundPendingBody,
        lookupId,
        sickwStatus,
        status: 502,
        supabaseAdmin,
        terminalStatus: refundFailureStatus,
      });
    } catch (cacheError) {
      console.error('[IMEI Check] Failed to cache refund pending state:', {
        cacheError,
        lookupId,
      });
      try {
        await cacheLookupResponse({
          body: refundPendingBody,
          lookupId,
          sickwStatus,
          status: 502,
          supabaseAdmin,
          terminalStatus: refundFailureStatus,
        });
      } catch (retryError) {
        console.error(
          '[IMEI Check] Retry cache of refund pending state failed:',
          {
            lookupId,
            retryError,
          }
        );
      }
      return json(refundPendingBody, 502);
    }
    return json(refundPendingBody, 502);
  }

  try {
    await cacheLookupResponse({
      body: terminalBody,
      lookupId,
      sickwStatus,
      status,
      supabaseAdmin,
      terminalStatus: refundSuccessStatus,
    });
  } catch (cacheError) {
    console.error('[IMEI Check] Failed to cache refunded lookup state:', {
      cacheError,
      lookupId,
    });
    try {
      await cacheLookupResponse({
        body: terminalBody,
        lookupId,
        sickwStatus,
        status,
        supabaseAdmin,
        terminalStatus: refundSuccessStatus,
      });
    } catch (retryError) {
      console.error(
        '[IMEI Check] Retry cache of refunded lookup state failed:',
        {
          lookupId,
          retryError,
        }
      );
    }
    return json(terminalBody, status);
  }

  return json(terminalBody, status);
}

export async function cacheInsufficientBalanceResponse({
  amount,
  customerId,
  lookupId,
  merchantId,
  preflightBalance,
  supabase,
  supabaseAdmin,
}: {
  amount: number;
  customerId: string;
  lookupId: string;
  merchantId: string;
  preflightBalance?: number;
  supabase: SupabaseClient;
  supabaseAdmin: AdminSupabaseClient;
}) {
  let currentBalance = preflightBalance;
  try {
    currentBalance = await readCustomerWalletBalance({
      customerId,
      merchantId,
      supabase,
    });
  } catch (readError) {
    console.error('[IMEI Check] Failed to reread wallet balance:', readError);
  }

  const body = errorBody({
    balance: currentBalance,
    code: 'WALLET_INSUFFICIENT',
    error: 'Insufficient wallet balance',
    required: amount,
  });
  const { error } = await supabaseAdmin
    .from('imei_lookups')
    .delete()
    .eq('id', lookupId)
    .select('id')
    .single();

  if (error) {
    throw new Error(
      `Failed to remove insufficient-balance IMEI lookup: ${error.message}`
    );
  }

  return json(body, 402);
}

export async function cacheSuccessfulLookup({
  amount,
  customerId,
  latencyMs,
  lookupId,
  merchantId,
  providerResult,
  supabaseAdmin,
  tier,
}: {
  amount: number;
  customerId: string;
  latencyMs: number;
  lookupId: string;
  merchantId: string;
  providerResult: Extract<SickwLookupResult, { ok: true }>;
  supabaseAdmin: AdminSupabaseClient;
  tier: ImeiServiceTierKey;
}) {
  const completeBody = {
    ...providerResult.body,
    data: await enrichImeiDeviceResult(merchantId, providerResult.body.data),
    lookupId,
    status: 'complete' as const,
  };
  try {
    await cacheLookupResponse({
      body: completeBody,
      lookupId,
      responseHash: hashProviderResponse(providerResult.rawResponseText),
      sickwStatus: providerResult.sickwStatus,
      status: providerResult.status,
      supabaseAdmin,
      terminalStatus: 'completed',
    });
  } catch (persistError) {
    console.error(
      '[IMEI Check] CRITICAL: paid lookup succeeded but result persistence failed; returning provider result without refund',
      {
        customer_id: customerId,
        error: persistError,
        lookup_id: lookupId,
        merchant_id: merchantId,
      }
    );
    console.info({
      amount,
      customer_id: customerId,
      latency_ms: latencyMs,
      lookup_id: lookupId,
      merchant_id: merchantId,
      outcome: 'completed_unpersisted',
      sickw_status: providerResult.sickwStatus,
      tier,
    });
    return json(completeBody, providerResult.status);
  }
  console.info({
    amount,
    customer_id: customerId,
    latency_ms: latencyMs,
    lookup_id: lookupId,
    merchant_id: merchantId,
    outcome: 'completed',
    sickw_status: providerResult.sickwStatus,
    tier,
  });
  return json(completeBody, providerResult.status);
}
