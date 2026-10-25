import { createHmac } from 'node:crypto';
import {
  canAssessImeiNetworkUnlock,
  isValidDeviceIdentifier,
  normalizeDeviceIdentifier,
} from '@baci/shared/imei';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getImeiHashSalt,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getRootDomain,
  isPetrockRemediationEnabled,
  isUsdtWalletEnabled,
} from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { encryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import { resolveImeiCustomer } from '@/lib/imei-lookup-fulfillment';
import { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { submitNextPetrockEligibilityCheck } from '@/lib/imei-remediation/petrock-eligibility-engine';
import { loadPetrockRemediationEligibility } from '@/lib/imei-remediation/petrock-remediation-eligibility-data';
import {
  createPetrockEligibilityAssessment,
  createPetrockEligibilityState,
  readPetrockHouseCheckProduct,
} from '@/lib/imei-remediation/petrock-remediation-state';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { createAdminClient } from '@/lib/supabase/admin';
import { imeiRemediationEligibilitySchema } from '@/schemas/imei-remediation';

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPetrockRemediationEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const rateLimit = await checkRateLimit(request);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ?? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
  }
  const parsed = imeiRemediationEligibilitySchema.safeParse(
    await request.json().catch(() => null)
  );
  if (
    !parsed.success ||
    !isValidDeviceIdentifier(parsed.data.identifier, 'both')
  ) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const merchant = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: parsed.data.merchantSlug,
    lookupError: 'Failed to validate storefront host',
    notFoundError: 'Remediation is only available on storefront hosts',
    request,
    rootDomain: getRootDomain() || 'usebaci.com',
  });
  if (!merchant.success) {
    return NextResponse.json(
      { error: merchant.error },
      { status: merchant.status }
    );
  }
  const merchantId = String(merchant.merchant.id);
  const customer = await resolveImeiCustomer({
    merchantId,
    supabase: auth.supabase,
    user: auth.user,
  });
  if (!customer) {
    return NextResponse.json({ error: 'Lookup not found' }, { status: 404 });
  }

  const salt = getImeiHashSalt();
  if (!salt) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
  const identifier = normalizeDeviceIdentifier(parsed.data.identifier, 'both');
  const identifierHash = createHmac('sha256', salt)
    .update(identifier)
    .digest('hex');
  const supabaseAdmin = createAdminClient();
  const result = await loadPetrockRemediationEligibility({
    customerId: customer.id,
    identifierHash,
    lookupId: parsed.data.lookupId,
    merchantId,
    supabaseAdmin,
  });
  if (result.kind === 'not_found') {
    return NextResponse.json({ error: 'Lookup not found' }, { status: 404 });
  }
  if (
    (result.kind === 'checks_required' || result.kind === 'eligible') &&
    !canAssessImeiNetworkUnlock(result.evidence)
  ) {
    return NextResponse.json({
      offers: [],
      reason: 'unlock_evidence_required',
      status: 'suppressed',
      success: true,
    });
  }
  if (result.kind === 'pending') {
    return NextResponse.json(
      {
        assessmentId: result.assessmentId,
        pollAfterMs: 5000,
        status: 'eligibility_pending',
        success: true,
      },
      { status: 202 }
    );
  }
  if (result.kind === 'checks_required') {
    const config = getPetrockConfig();
    const encryptionKey = getImeiIdentifierEncryptionKey();
    if (!config || !encryptionKey) {
      return NextResponse.json(
        { error: 'Service unavailable' },
        { status: 503 }
      );
    }
    const assessment = await createPetrockEligibilityAssessment({
      customerId: customer.id,
      evidence: result.evidence,
      identifierCiphertext: encryptImeiIdentifier(identifier, encryptionKey),
      identifierHash,
      merchantId,
      sourceLookupId: parsed.data.lookupId,
      supabaseAdmin,
    });
    await submitNextPetrockEligibilityCheck({
      client: createPetrockClient(config),
      identifier,
      order: assessment,
      origin: new URL(request.url).origin,
      readProduct: (productId) =>
        readPetrockHouseCheckProduct(supabaseAdmin, productId),
      state: createPetrockEligibilityState(supabaseAdmin),
    });
    return NextResponse.json(
      {
        assessmentId: assessment.id,
        checks: result.checks,
        pollAfterMs: 5000,
        status: 'eligibility_pending',
        success: true,
      },
      { status: 202 }
    );
  }
  if (result.kind === 'suppressed') {
    return NextResponse.json({
      offers: [],
      reason: result.reason,
      status: 'suppressed',
      success: true,
    });
  }
  let assessmentId = result.assessmentId;
  if (result.needsAssessment) {
    const encryptionKey = getImeiIdentifierEncryptionKey();
    const offer = result.offers[0];
    if (!encryptionKey || !offer) {
      return NextResponse.json(
        { error: 'Service unavailable' },
        { status: 503 }
      );
    }
    const assessment = await createPetrockEligibilityAssessment({
      customerId: customer.id,
      evidence: result.evidence,
      identifierCiphertext: encryptImeiIdentifier(identifier, encryptionKey),
      identifierHash,
      merchantId,
      sourceLookupId: parsed.data.lookupId,
      supabaseAdmin,
    });
    const resolved = await createPetrockEligibilityState(
      supabaseAdmin
    ).resolveEligibility({
      carrier: offer.carrier,
      customerMessage: 'A verified clean carrier-unlock service is available.',
      deviceModel: result.evidence.device,
      orderId: assessment.id,
      statusSegment: offer.statusSegment,
    });
    if (!resolved) {
      return NextResponse.json(
        { error: 'Service unavailable' },
        { status: 503 }
      );
    }
    assessmentId = assessment.id;
  }
  return NextResponse.json({
    assessmentId,
    offers: result.offers,
    status: 'eligible',
    success: true,
    usdtEnabled: isUsdtWalletEnabled(),
  });
}
