import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getRootDomain,
} from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { resolveImeiCustomer } from '@/lib/imei-lookup-fulfillment';
import { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { resolveClaimedPetrockLookup } from '@/lib/imei-providers/petrock/petrock-lookup-resolution';
import { claimPetrockLookupPoll } from '@/lib/imei-providers/petrock/petrock-lookup-state';
import { createPetrockProvider } from '@/lib/imei-providers/petrock/petrock-provider';
import {
  checkImeiPollRateLimit,
  createRateLimitResponse,
} from '@/lib/rate-limit';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { createAdminClient } from '@/lib/supabase/admin';
import { RouteIdentifierSchema } from '@/schemas/route-identifier';
import { errorBody, UUID_PATTERN } from '../route-helpers';

interface LookupStatusRow {
  cached_response: Record<string, unknown> | null;
  cached_status: number | null;
  customer_id: string;
  id: string;
  merchant_id: string;
  status: string;
}

function pending(lookupId: string, pollAfterMs = 2_000) {
  return NextResponse.json(
    { lookupId, pollAfterMs, status: 'pending', success: true },
    { status: 202 }
  );
}

export async function GET(
  request: NextRequest | Request,
  { params }: { params: Promise<{ lookupId: string }> }
) {
  const auth = await authenticateApiRequest(request as NextRequest);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      errorBody({ code: 'AUTH_REQUIRED', error: 'Unauthorized' }),
      { status: 401 }
    );
  }

  const rateLimit = await checkImeiPollRateLimit(request as NextRequest);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }

  const { lookupId } = await params;
  if (!UUID_PATTERN.test(lookupId)) {
    return NextResponse.json(
      errorBody({ code: 'LOOKUP_NOT_FOUND', error: 'Lookup not found' }),
      { status: 404 }
    );
  }

  const rawMerchantSlug = new URL(request.url).searchParams.get('merchantSlug');
  const parsedMerchantSlug =
    rawMerchantSlug === null
      ? undefined
      : RouteIdentifierSchema.safeParse(rawMerchantSlug);
  if (parsedMerchantSlug && !parsedMerchantSlug.success) {
    return NextResponse.json(
      errorBody({
        code: 'INVALID_MERCHANT_SLUG',
        error: 'Invalid merchant slug',
      }),
      { status: 400 }
    );
  }

  const merchantResolution = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: parsedMerchantSlug?.data,
    lookupError: 'Failed to validate storefront host',
    notFoundError: 'IMEI check is only available on storefront hosts',
    request: request as NextRequest,
    rootDomain: getRootDomain() || 'usebaci.com',
  });
  if (!merchantResolution.success) {
    return NextResponse.json(
      errorBody({
        code: 'STOREFRONT_NOT_FOUND',
        error: merchantResolution.error,
      }),
      { status: merchantResolution.status }
    );
  }
  const merchantId = String(merchantResolution.merchant.id);
  const customer = await resolveImeiCustomer({
    merchantId,
    supabase: auth.supabase,
    user: auth.user,
  });
  if (!customer) {
    return NextResponse.json(
      errorBody({ code: 'LOOKUP_NOT_FOUND', error: 'Lookup not found' }),
      { status: 404 }
    );
  }

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('imei_lookups')
    .select(
      'id, customer_id, merchant_id, status, cached_response, cached_status'
    )
    .eq('id', lookupId)
    .eq('customer_id', customer.id)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) {
    console.error('[Petrock IMEI Status] Lookup read failed', {
      error,
      lookupId,
    });
    return NextResponse.json(
      errorBody({ code: 'LOOKUP_READ_FAILED', error: 'Unable to read lookup' }),
      { status: 500 }
    );
  }

  const row = data as LookupStatusRow | null;
  if (
    !row ||
    row.customer_id !== customer.id ||
    row.merchant_id !== merchantId
  ) {
    return NextResponse.json(
      errorBody({ code: 'LOOKUP_NOT_FOUND', error: 'Lookup not found' }),
      { status: 404 }
    );
  }

  if (row.cached_response && row.cached_status) {
    return NextResponse.json(
      {
        ...row.cached_response,
        lookupId: row.id,
        status:
          row.cached_response.success === true
            ? 'complete'
            : ('error' as const),
      },
      { status: row.cached_status }
    );
  }

  if (
    row.status !== 'pending_provider' &&
    row.status !== 'provider_submitting' &&
    row.status !== 'submission_unknown'
  ) {
    return NextResponse.json(
      errorBody({ code: 'LOOKUP_UNAVAILABLE', error: 'Lookup is unavailable' }),
      { status: 409 }
    );
  }
  if (row.status === 'provider_submitting') return pending(lookupId, 5_000);

  const config = getPetrockConfig();
  const encryptionKey = getImeiIdentifierEncryptionKey();
  if (!config || !encryptionKey) {
    console.error('[Petrock IMEI Status] Provider configuration unavailable', {
      lookupId,
    });
    return pending(lookupId, 60_000);
  }

  const leaseToken = randomUUID();
  const claimed = await claimPetrockLookupPoll({
    customerId: customer.id,
    leaseToken,
    lookupId,
    merchantId,
    supabaseAdmin,
  });
  if (!claimed) return pending(lookupId);

  try {
    const provider = createPetrockProvider({
      client: createPetrockClient(config),
    });
    const result = await resolveClaimedPetrockLookup({
      encryptionKey,
      lookup: claimed,
      merchantId,
      provider,
      supabaseAdmin,
    });
    if (result.kind === 'pending' || result.kind === 'lease_lost') {
      return pending(lookupId, result.pollAfterMs);
    }
    return NextResponse.json(
      { ...result.body, lookupId: row.id },
      { status: result.status }
    );
  } catch (resolutionError) {
    console.error('[Petrock IMEI Status] Provider poll failed', {
      error: resolutionError,
      lookupId,
    });
    return pending(lookupId, 30_000);
  }
}
