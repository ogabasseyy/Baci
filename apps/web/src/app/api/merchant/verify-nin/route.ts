import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { isBaciPaystackSettlementCountry } from '@/lib/checkout/payment-gateway-availability';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { getMonnifyToken } from '@/lib/monnify';
import { getMonnifyBaseUrl } from '@/lib/monnify-provider-config';
import { ninVerifySchema } from '@/schemas/verification';
import type { MonnifyNINResponse } from '@/types/monnify';
import { getVerificationRateLimitError } from '../verification-rate-limit';

function normalizeNameParts(name: string): string[] {
  return name.trim().toUpperCase().split(/\s+/).filter(Boolean).sort();
}

function namesMatch(
  inputFirst: string,
  inputLast: string,
  returnedFirst: string,
  returnedLast: string,
  returnedMiddle = ''
): boolean {
  const inputParts = normalizeNameParts(`${inputFirst} ${inputLast}`);
  const returnedParts = normalizeNameParts(
    `${returnedFirst} ${returnedMiddle} ${returnedLast}`
  );

  // Exact sorted-word match handles "John Doe" vs "Doe John"
  if (inputParts.join(' ') === returnedParts.join(' ')) return true;

  // Subset match: all input words present in returned words (handles middle names)
  // Require at least 2 matching parts to avoid single-word false positives
  if (inputParts.length < 2) return false;
  return inputParts.every((w) => returnedParts.includes(w));
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error ?? 'Unauthorized' },
      { status: 401 }
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const parsed = ninVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { nin, firstName, lastName, dateOfBirth, merchantId } = parsed.data;
  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: merchantId }
  );
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!merchantContext.staffAccess.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: merchantRecord, error: merchantError } = await auth.supabase
    .from('merchants')
    .select('country')
    .eq('id', merchantContext.merchantId)
    .maybeSingle();
  if (merchantError) {
    console.error('verify-nin: failed to load merchant country', merchantError);
    return NextResponse.json(
      { error: 'Unable to load merchant verification details' },
      { status: 500 }
    );
  }
  if (!merchantRecord) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!isBaciPaystackSettlementCountry(merchantRecord.country)) {
    return NextResponse.json(
      { error: 'NIN verification is only available for Nigerian merchants' },
      { status: 400 }
    );
  }

  const preflightRateLimitError = await getVerificationRateLimitError(
    auth.supabase,
    auth.user.id,
    'verify-nin-preflight',
    30
  );
  if (preflightRateLimitError) return preflightRateLimitError;

  try {
    const providerRateLimitError = await getVerificationRateLimitError(
      auth.supabase,
      auth.user.id,
      'verify-nin',
      3
    );
    if (providerRateLimitError) return providerRateLimitError;

    const token = await getMonnifyToken();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let monnifyRes: Response;
    try {
      monnifyRes = await fetch(
        `${getMonnifyBaseUrl()}/api/v1/vas/nin-details`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nin }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!monnifyRes.ok) {
      throw new Error(`Monnify NIN lookup failed: ${monnifyRes.status}`);
    }

    const data = (await monnifyRes.json()) as MonnifyNINResponse;

    if (!data.responseBody) {
      console.error('verify-nin: unexpected Monnify response structure');
      return NextResponse.json(
        { error: 'NIN verification service returned invalid data' },
        { status: 502 }
      );
    }

    const retFirst = data.responseBody.firstName ?? '';
    const retLast = data.responseBody.lastName ?? '';
    const retMiddle = data.responseBody.middleName ?? '';

    const verified = namesMatch(
      firstName,
      lastName,
      retFirst,
      retLast,
      retMiddle
    );

    if (verified) {
      const { error: rpcError } = await auth.supabase.rpc(
        'record_nin_verification',
        {
          p_merchant_id: merchantContext.merchantId,
          p_nin: nin,
          p_first_name: firstName,
          p_last_name: lastName,
          p_date_of_birth: dateOfBirth,
        }
      );

      if (rpcError) {
        console.error('record_nin_verification RPC error:', {
          code: rpcError.code,
          message: rpcError.message,
          merchantId: merchantContext.merchantId,
        });
        return NextResponse.json(
          { error: 'Failed to record verification' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ verified });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.error(
      isTimeout ? 'verify-nin error (timeout):' : 'verify-nin error:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return NextResponse.json(
      {
        error: isTimeout
          ? 'NIN verification timed out'
          : 'NIN verification failed',
      },
      { status: 500 }
    );
  }
}
