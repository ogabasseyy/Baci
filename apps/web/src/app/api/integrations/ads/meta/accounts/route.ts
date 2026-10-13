import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import { resolveMetaAdsAccessToken } from '@/lib/ads/meta/access-token';
import {
  getMetaAdsConfig,
  META_ADS_CONFIG_MISSING,
  MetaAdsConfigError,
} from '@/lib/ads/meta/config';
import { META_ADS_PROVIDER } from '@/lib/ads/meta/constants';
import {
  listMetaAdsAccounts,
  MetaAdsProviderError,
} from '@/lib/ads/meta/provider';
import {
  MetaAdsReauthPersistenceError,
  markMetaAdsReauthRequired,
} from '@/lib/ads/meta/sync';
import {
  type AdsCredentialServiceClient,
  createAdsCredentialServiceClient,
} from '@/lib/ads/server-credential-client';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { metaAdsAccountSelectionSchema } from '@/schemas/meta-ads';

async function connectionForMerchant(
  supabase: AdsCredentialServiceClient,
  merchantId: string
) {
  const result = await supabase.rpc('get_merchant_ads_connection_secret', {
    p_merchant_id: merchantId,
    p_provider: META_ADS_PROVIDER,
  });
  return result.error
    ? { error: true as const }
    : { connection: result.data?.[0] ?? null };
}

function reauthFailureCode(
  error: unknown
):
  | 'META_ADS_ACCESS_REVOKED'
  | 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED'
  | 'META_ADS_REAUTH_REQUIRED'
  | null {
  const code =
    error instanceof MetaAdsProviderError
      ? error.code
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object'
          ? (error as { code?: unknown }).code
          : null;
  return code === 'META_ADS_ACCESS_REVOKED' ||
    code === 'META_ADS_ACCESS_TOKEN_DECRYPT_FAILED' ||
    code === 'META_ADS_REAUTH_REQUIRED'
    ? code
    : null;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(access, 'integrations', 'manage'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  const credentialSupabase = createAdsCredentialServiceClient();
  let connection: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
  } | null = null;
  try {
    const config = getMetaAdsConfig();
    const result = await connectionForMerchant(
      credentialSupabase,
      access.merchantId
    );
    if (!result || ('error' in result && result.error))
      return NextResponse.json(
        { error: 'Failed to read Meta Ads connection' },
        { status: 500 }
      );
    if (result.connection?.status !== 'active')
      return NextResponse.json({ accounts: [], connected: false });
    connection = result.connection;
    const accounts = await listMetaAdsAccounts(
      resolveMetaAdsAccessToken(result.connection, config)
    );
    return NextResponse.json({
      accounts: accounts.map(
        ({ accountId, currencyCode, label, timezoneName }) => ({
          accountId,
          currencyCode,
          label,
          selected: accountId === result.connection?.provider_customer_id,
          timezoneName,
        })
      ),
      connected: true,
    });
  } catch (error) {
    const failureCode = reauthFailureCode(error);
    if (connection && failureCode) {
      try {
        await markMetaAdsReauthRequired({
          connection,
          failureCode,
          merchantId: access.merchantId,
          credentialSupabase,
        });
      } catch (persistError) {
        if (persistError instanceof MetaAdsReauthPersistenceError)
          return NextResponse.json(
            { error: persistError.code },
            { status: 502 }
          );
      }
    }
    if (
      error instanceof MetaAdsConfigError ||
      (error instanceof Error && error.name === 'MetaAdsConfigError')
    ) {
      return NextResponse.json(
        { error: META_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    }
    if (
      error instanceof MetaAdsProviderError ||
      (error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string')
    ) {
      return NextResponse.json(
        { error: (error as { code: string }).code },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: 'META_ADS_AUTHORIZATION_UNAVAILABLE' },
      { status: 502 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = metaAdsAccountSelectionSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  const merchant = await resolveAdsMerchantAccess({
    request,
    supabase: auth.supabase,
    userId: auth.user.id,
  });
  if (merchant.response) return merchant.response;
  const access = merchant.access;
  if (!access)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(access, 'integrations', 'manage'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  const credentialSupabase = createAdsCredentialServiceClient();
  let connection: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
  } | null = null;
  try {
    const result = await connectionForMerchant(
      credentialSupabase,
      access.merchantId
    );
    if (!result || ('error' in result && result.error))
      return NextResponse.json(
        { error: 'Failed to read Meta Ads connection' },
        { status: 500 }
      );
    if (!result.connection)
      return NextResponse.json(
        { error: 'Meta Ads is not connected' },
        { status: 404 }
      );
    connection = result.connection;
    const accounts = await listMetaAdsAccounts(
      resolveMetaAdsAccessToken(result.connection, getMetaAdsConfig())
    );
    const account = accounts.find(
      (candidate) => candidate.accountId === parsed.data.accountId
    );
    if (!account)
      return NextResponse.json(
        { error: 'Meta Ads account is not accessible' },
        { status: 400 }
      );
    const { data, error } = await credentialSupabase.rpc(
      'set_merchant_ads_account',
      {
        p_account_timezone: account.timezoneName,
        p_attribution_metadata: {
          currencyCode: account.currencyCode,
          providerTimezoneOffsetHours: account.timezoneOffsetHours,
        },
        p_expected_access_token_ciphertext:
          result.connection.access_token_ciphertext,
        p_merchant_id: access.merchantId,
        p_provider: META_ADS_PROVIDER,
        p_provider_account_label: account.label,
        p_provider_customer_id: account.accountId,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'Failed to select Meta Ads account' },
        { status: 500 }
      );
    if (data !== true)
      return NextResponse.json(
        { error: 'Meta Ads authorization changed; retry account selection' },
        { status: 409 }
      );
    invalidateAdsAnalyticsCache(access.merchantId);
    return NextResponse.json({ accountId: account.accountId, selected: true });
  } catch (error) {
    const failureCode = reauthFailureCode(error);
    if (connection && failureCode) {
      try {
        await markMetaAdsReauthRequired({
          connection,
          failureCode,
          merchantId: access.merchantId,
          credentialSupabase,
        });
      } catch (persistError) {
        if (persistError instanceof MetaAdsReauthPersistenceError)
          return NextResponse.json(
            { error: persistError.code },
            { status: 502 }
          );
      }
    }
    if (
      error instanceof MetaAdsConfigError ||
      (error instanceof Error && error.name === 'MetaAdsConfigError')
    ) {
      return NextResponse.json(
        { error: META_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    }
    if (
      error instanceof MetaAdsProviderError ||
      (error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string')
    ) {
      return NextResponse.json(
        { error: (error as { code: string }).code },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: 'META_ADS_AUTHORIZATION_UNAVAILABLE' },
      { status: 502 }
    );
  }
}
