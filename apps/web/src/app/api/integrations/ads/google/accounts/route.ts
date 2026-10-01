import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { createAdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  type GoogleAdsResolvedAccessToken,
  resolveGoogleAdsAccessToken,
} from '@/lib/google-ads/access-token';
import {
  GOOGLE_ADS_CONFIG_MISSING,
  getGoogleAdsOAuthConfig,
  getGoogleAdsReportingConfig,
} from '@/lib/google-ads/config';
import { persistGoogleAdsAccessToken } from '@/lib/google-ads/persist-access-token';
import { listGoogleAdsAccessibleCustomerIds } from '@/lib/google-ads/provider';
import {
  getGoogleAdsReauthReason,
  persistGoogleAdsReauthRequired,
} from '@/lib/google-ads/reauth';
import { googleAdsAccountSelectionSchema } from '@/schemas/google-ads';
import { handleGoogleAdsAccountDiscoveryError } from './discovery-error-handler';
import { tokenResolutionErrorResponse } from './token-resolution-error-response';

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  let oauthConfig: ReturnType<typeof getGoogleAdsOAuthConfig>;
  let reportingConfig: ReturnType<typeof getGoogleAdsReportingConfig>;
  try {
    oauthConfig = getGoogleAdsOAuthConfig();
    reportingConfig = getGoogleAdsReportingConfig();
  } catch (error) {
    if (error instanceof Error && error.name === 'GoogleAdsConfigError') {
      return NextResponse.json(
        { error: GOOGLE_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: 'Google Ads integration unavailable' },
      { status: 503 }
    );
  }

  // The connection secret and token CAS RPCs are service-role-only. Create the
  // dedicated credential client only after all user/merchant/permission gates
  // have passed; keep auth.supabase for non-sensitive user-scoped operations.
  const credentialSupabase = createAdsCredentialServiceClient();
  const { data: connections, error: connectionError } =
    await credentialSupabase.rpc('get_google_ads_connection_secret', {
      p_merchant_id: access.merchantId,
    });
  if (connectionError) {
    return NextResponse.json(
      { error: 'Failed to read Google Ads connection' },
      { status: 500 }
    );
  }
  let connection = connections?.[0] ?? null;
  if (connection?.status !== 'active') {
    return NextResponse.json({ connected: false, accounts: [] });
  }

  let resolvedToken: GoogleAdsResolvedAccessToken;
  try {
    resolvedToken = await resolveGoogleAdsAccessToken(connection, oauthConfig);
  } catch (error) {
    const reason = getGoogleAdsReauthReason(error);
    if (
      reason &&
      !(await persistGoogleAdsReauthRequired({
        connection,
        credentialSupabase,
        merchantId: access.merchantId,
        reason,
      }))
    ) {
      return NextResponse.json(
        { error: 'Failed to update Google Ads authorization status' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'Google Ads authorization expired' },
      { status: 502 }
    );
  }
  const tokenPersistence = await persistGoogleAdsAccessToken({
    connection,
    credentialSupabase,
    merchantId: access.merchantId,
    resolvedToken,
  });
  if (tokenPersistence.status === 'error') {
    return NextResponse.json(
      { error: 'Failed to update Google Ads token' },
      { status: 500 }
    );
  }
  if (tokenPersistence.status === 'conflict') {
    return NextResponse.json(
      {
        error: 'Google Ads authorization changed; retry account discovery',
        retry: true,
      },
      { status: 409 }
    );
  }
  connection = { ...connection, ...tokenPersistence.connection };

  try {
    const customerIds = await listGoogleAdsAccessibleCustomerIds(
      resolvedToken.accessToken,
      reportingConfig
    );
    return NextResponse.json({
      accounts: customerIds.map((customerId) => ({
        customerId,
        selected: customerId === connection.provider_customer_id,
      })),
      connected: true,
    });
  } catch (error) {
    return handleGoogleAdsAccountDiscoveryError({
      connection,
      credentialSupabase,
      error,
      merchantId: access.merchantId,
    });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = googleAdsAccountSelectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  let oauthConfig: ReturnType<typeof getGoogleAdsOAuthConfig>;
  let reportingConfig: ReturnType<typeof getGoogleAdsReportingConfig>;
  try {
    oauthConfig = getGoogleAdsOAuthConfig();
    reportingConfig = getGoogleAdsReportingConfig();
  } catch {
    return NextResponse.json(
      { error: GOOGLE_ADS_CONFIG_MISSING },
      { status: 503 }
    );
  }
  const credentialSupabase = createAdsCredentialServiceClient();
  const { data: connections, error: connectionError } =
    await credentialSupabase.rpc('get_google_ads_connection_secret', {
      p_merchant_id: access.merchantId,
    });
  if (connectionError) {
    return NextResponse.json(
      { error: 'Failed to read Google Ads connection' },
      { status: 500 }
    );
  }
  let connection = connections?.[0] ?? null;
  if (!connection) {
    return NextResponse.json(
      { error: 'Google Ads is not connected' },
      { status: 404 }
    );
  }
  let resolvedToken: GoogleAdsResolvedAccessToken;
  try {
    resolvedToken = await resolveGoogleAdsAccessToken(connection, oauthConfig);
  } catch (error) {
    return tokenResolutionErrorResponse({
      connection,
      credentialSupabase,
      error,
      merchantId: access.merchantId,
    });
  }
  const tokenPersistence = await persistGoogleAdsAccessToken({
    connection,
    credentialSupabase,
    merchantId: access.merchantId,
    resolvedToken,
  });
  if (tokenPersistence.status === 'error') {
    return NextResponse.json(
      { error: 'Failed to update Google Ads token' },
      { status: 500 }
    );
  }
  if (tokenPersistence.status === 'conflict') {
    return NextResponse.json(
      { error: 'Google Ads authorization changed; retry account selection' },
      { status: 409 }
    );
  }
  connection = { ...connection, ...tokenPersistence.connection };
  let customerIds: string[];
  try {
    customerIds = await listGoogleAdsAccessibleCustomerIds(
      resolvedToken.accessToken,
      reportingConfig
    );
  } catch (error) {
    return handleGoogleAdsAccountDiscoveryError({
      connection,
      credentialSupabase,
      error,
      merchantId: access.merchantId,
    });
  }
  if (!customerIds.includes(parsed.data.customerId)) {
    return NextResponse.json(
      { error: 'Google Ads customer is not accessible' },
      { status: 400 }
    );
  }
  const { data: updated, error: updateError } = await credentialSupabase.rpc(
    'set_google_ads_customer',
    {
      p_expected_access_token_ciphertext: connection.access_token_ciphertext,
      p_merchant_id: access.merchantId,
      p_provider_customer_id: parsed.data.customerId,
    }
  );
  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to select Google Ads account' },
      { status: 500 }
    );
  }
  if (updated !== true) {
    return NextResponse.json(
      { error: 'Google Ads authorization changed; retry account selection' },
      { status: 409 }
    );
  }
  invalidateAdsAnalyticsCache(access.merchantId);
  return NextResponse.json({
    customerId: parsed.data.customerId,
    selected: true,
  });
}
