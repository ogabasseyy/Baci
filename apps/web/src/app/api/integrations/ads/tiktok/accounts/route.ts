import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import {
  type AdsCredentialServiceClient,
  createAdsCredentialServiceClient,
} from '@/lib/ads/server-credential-client';
import { resolveTikTokAdsAccessToken } from '@/lib/ads/tiktok/access-token';
import {
  getTikTokAdsConfig,
  TIKTOK_ADS_CONFIG_MISSING,
  TikTokAdsConfigError,
} from '@/lib/ads/tiktok/config';
import { TIKTOK_ADS_PROVIDER } from '@/lib/ads/tiktok/constants';
import {
  listTikTokAdsAccounts,
  TikTokAdsProviderError,
} from '@/lib/ads/tiktok/provider';
import {
  markTikTokAdsReauthRequired,
  TikTokAdsReauthPersistenceError,
} from '@/lib/ads/tiktok/sync';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { tiktokAdsAccountSelectionSchema } from '@/schemas/tiktok-ads';

async function connection(
  supabase: AdsCredentialServiceClient,
  merchantId: string
) {
  const result = await supabase.rpc('get_merchant_ads_connection_secret', {
    p_merchant_id: merchantId,
    p_provider: TIKTOK_ADS_PROVIDER,
  });
  return result.error
    ? { error: true as const }
    : { connection: result.data?.[0] ?? null };
}
function reauthFailureCode(
  error: unknown
):
  | 'TIKTOK_ADS_ACCESS_REVOKED'
  | 'TIKTOK_ADS_ACCESS_TOKEN_DECRYPT_FAILED'
  | 'TIKTOK_ADS_REAUTH_REQUIRED'
  | null {
  const code =
    error instanceof TikTokAdsProviderError
      ? error.code
      : error instanceof Error
        ? error.message
        : error && typeof error === 'object'
          ? (error as { code?: unknown }).code
          : null;
  return code === 'TIKTOK_ADS_ACCESS_REVOKED' ||
    code === 'TIKTOK_ADS_ACCESS_TOKEN_DECRYPT_FAILED' ||
    code === 'TIKTOK_ADS_REAUTH_REQUIRED'
    ? code
    : null;
}
async function handleRevocation(
  error: unknown,
  current: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
  } | null,
  merchantId: string,
  credentialSupabase: AdsCredentialServiceClient
): Promise<NextResponse | null> {
  const failureCode = reauthFailureCode(error);
  if (!current || !failureCode) return null;
  try {
    await markTikTokAdsReauthRequired({
      connection: current,
      failureCode,
      merchantId,
      credentialSupabase,
    });
    return null;
  } catch (persist) {
    return persist instanceof TikTokAdsReauthPersistenceError
      ? NextResponse.json({ error: persist.code }, { status: 502 })
      : null;
  }
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
  let current: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
  } | null = null;
  try {
    const config = getTikTokAdsConfig();
    const result = await connection(credentialSupabase, access.merchantId);
    if (!result || ('error' in result && result.error))
      return NextResponse.json(
        { error: 'Failed to read TikTok Ads connection' },
        { status: 500 }
      );
    if (result.connection?.status !== 'active')
      return NextResponse.json({ accounts: [], connected: false });
    current = result.connection;
    const accounts = await listTikTokAdsAccounts({
      accessToken: resolveTikTokAdsAccessToken(result.connection, config),
      appId: config.appId,
      appSecret: config.appSecret,
    });
    return NextResponse.json({
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        currencyCode: account.currencyCode,
        label: account.label,
        selected: account.accountId === current?.provider_customer_id,
        timezoneName: account.timezoneName,
      })),
      connected: true,
    });
  } catch (error) {
    const revocation = await handleRevocation(
      error,
      current,
      access.merchantId,
      credentialSupabase
    );
    if (revocation) return revocation;
    if (error instanceof TikTokAdsConfigError)
      return NextResponse.json(
        { error: TIKTOK_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    return NextResponse.json(
      {
        error:
          error instanceof TikTokAdsProviderError
            ? error.code
            : 'TIKTOK_ADS_AUTHORIZATION_UNAVAILABLE',
      },
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
  const parsed = tiktokAdsAccountSelectionSchema.safeParse(body);
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
  let current: {
    access_token_ciphertext: string | null;
    provider_customer_id: string | null;
    refresh_token_ciphertext: string | null;
  } | null = null;
  try {
    const result = await connection(credentialSupabase, access.merchantId);
    if (!result || ('error' in result && result.error))
      return NextResponse.json(
        { error: 'Failed to read TikTok Ads connection' },
        { status: 500 }
      );
    if (!result.connection)
      return NextResponse.json(
        { error: 'TikTok Ads is not connected' },
        { status: 404 }
      );
    current = result.connection;
    const config = getTikTokAdsConfig();
    const account = (
      await listTikTokAdsAccounts({
        accessToken: resolveTikTokAdsAccessToken(result.connection, config),
        appId: config.appId,
        appSecret: config.appSecret,
      })
    ).find((item) => item.accountId === parsed.data.accountId);
    if (!account)
      return NextResponse.json(
        { error: 'TikTok Ads account is not accessible' },
        { status: 400 }
      );
    const { data, error } = await credentialSupabase.rpc(
      'set_merchant_ads_account',
      {
        p_account_timezone: account.timezoneName,
        p_attribution_metadata: {
          currencyCode: account.currencyCode,
          providerVersion: 'v1.3',
        },
        p_expected_access_token_ciphertext:
          result.connection.access_token_ciphertext,
        p_merchant_id: access.merchantId,
        p_provider: TIKTOK_ADS_PROVIDER,
        p_provider_account_label: account.label,
        p_provider_customer_id: account.accountId,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'Failed to select TikTok Ads account' },
        { status: 500 }
      );
    if (data !== true)
      return NextResponse.json(
        {
          error: 'TikTok Ads authorization changed; retry account selection',
        },
        { status: 409 }
      );
    invalidateAdsAnalyticsCache(access.merchantId);
    return NextResponse.json({ accountId: account.accountId, selected: true });
  } catch (error) {
    const revocation = await handleRevocation(
      error,
      current,
      access.merchantId,
      credentialSupabase
    );
    if (revocation) return revocation;
    if (error instanceof TikTokAdsConfigError)
      return NextResponse.json(
        { error: TIKTOK_ADS_CONFIG_MISSING },
        { status: 503 }
      );
    return NextResponse.json(
      {
        error:
          error instanceof TikTokAdsProviderError
            ? error.code
            : 'TIKTOK_ADS_AUTHORIZATION_UNAVAILABLE',
      },
      { status: 502 }
    );
  }
}
