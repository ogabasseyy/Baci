import { type NextRequest, NextResponse } from 'next/server';
import { invalidateAdsAnalyticsCache } from '@/lib/ads/analytics-cache';
import { resolveAdsMerchantAccess } from '@/lib/ads/merchant-context';
import {
  type AdsCredentialServiceClient,
  createAdsCredentialServiceClient,
} from '@/lib/ads/server-credential-client';
import {
  getSnapchatAdsUsableGrant,
  SnapchatAdsTokenRefreshError,
} from '@/lib/ads/snapchat/access-token';
import {
  getSnapchatAdsConfig,
  SNAPCHAT_ADS_CONFIG_MISSING,
  SnapchatAdsConfigError,
} from '@/lib/ads/snapchat/config';
import { SNAPCHAT_ADS_PROVIDER } from '@/lib/ads/snapchat/constants';
import {
  listSnapchatAdsAccounts,
  SnapchatAdsProviderError,
} from '@/lib/ads/snapchat/provider';
import { markSnapchatAdsReauthRequired } from '@/lib/ads/snapchat/sync';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { snapchatAdsAccountSelectionSchema } from '@/schemas/snapchat-ads';

type SecretConnection = {
  access_token_ciphertext: string | null;
  provider_customer_id: string | null;
  refresh_token_ciphertext: string | null;
  status: string;
  token_expires_at: string | null;
};
async function connection(
  supabase: AdsCredentialServiceClient,
  merchantId: string
) {
  const result = await supabase.rpc('get_merchant_ads_connection_secret', {
    p_merchant_id: merchantId,
    p_provider: SNAPCHAT_ADS_PROVIDER,
  });
  return result.error
    ? { error: true as const }
    : { connection: result.data?.[0] as SecretConnection | null };
}
async function revoked(
  error: unknown,
  current: SecretConnection | null,
  merchantId: string,
  credentialSupabase: AdsCredentialServiceClient
) {
  const shouldMarkReauth =
    (error instanceof SnapchatAdsProviderError &&
      error.code === 'SNAPCHAT_ADS_ACCESS_REVOKED') ||
    (error instanceof SnapchatAdsTokenRefreshError &&
      (error.code === 'SNAPCHAT_ADS_REFRESH_REJECTED' ||
        error.code === 'SNAPCHAT_ADS_REFRESH_TOKEN_DECRYPT_FAILED'));
  if (!current || !shouldMarkReauth) return null;
  try {
    await markSnapchatAdsReauthRequired({
      connection: current,
      failureCode: error.code,
      merchantId,
      credentialSupabase,
    });
    return null;
  } catch {
    return NextResponse.json(
      { error: 'SNAPCHAT_ADS_REAUTH_PERSIST_FAILED' },
      { status: 502 }
    );
  }
}
function providerFailure(error: unknown) {
  if (error instanceof SnapchatAdsConfigError)
    return NextResponse.json(
      { error: SNAPCHAT_ADS_CONFIG_MISSING },
      { status: 503 }
    );
  return NextResponse.json(
    {
      error:
        error instanceof SnapchatAdsProviderError
          ? error.code
          : 'SNAPCHAT_ADS_AUTHORIZATION_UNAVAILABLE',
    },
    { status: 502 }
  );
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
  let current: SecretConnection | null = null;
  try {
    const read = await connection(credentialSupabase, access.merchantId);
    if (!read || ('error' in read && read.error))
      return NextResponse.json(
        { error: 'Failed to read Snapchat Ads connection' },
        { status: 500 }
      );
    if (read.connection?.status !== 'active')
      return NextResponse.json({ accounts: [], connected: false });
    current = read.connection;
    const config = getSnapchatAdsConfig();
    const usableGrant = await getSnapchatAdsUsableGrant({
      config,
      connection: current,
      merchantId: access.merchantId,
      credentialSupabase,
    });
    current = {
      ...current,
      access_token_ciphertext: usableGrant.accessTokenCiphertext,
      refresh_token_ciphertext: usableGrant.refreshTokenCiphertext,
      token_expires_at: usableGrant.tokenExpiresAt,
    };
    const accounts = await listSnapchatAdsAccounts({
      accessToken: usableGrant.accessToken,
    });
    return NextResponse.json({
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        currencyCode: account.currencyCode,
        label: account.label,
        organizationId: account.organizationId,
        selected: account.accountId === current?.provider_customer_id,
        timezoneName: account.timezoneName,
      })),
      connected: true,
    });
  } catch (error) {
    return (
      (await revoked(error, current, access.merchantId, credentialSupabase)) ??
      providerFailure(error)
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
  const parsed = snapchatAdsAccountSelectionSchema.safeParse(body);
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
  let current: SecretConnection | null = null;
  try {
    const read = await connection(credentialSupabase, access.merchantId);
    if (!read || ('error' in read && read.error))
      return NextResponse.json(
        { error: 'Failed to read Snapchat Ads connection' },
        { status: 500 }
      );
    if (!read.connection)
      return NextResponse.json(
        { error: 'Snapchat Ads is not connected' },
        { status: 404 }
      );
    current = read.connection;
    const config = getSnapchatAdsConfig();
    const usableGrant = await getSnapchatAdsUsableGrant({
      config,
      connection: current,
      merchantId: access.merchantId,
      credentialSupabase,
    });
    current = {
      ...current,
      access_token_ciphertext: usableGrant.accessTokenCiphertext,
      refresh_token_ciphertext: usableGrant.refreshTokenCiphertext,
      token_expires_at: usableGrant.tokenExpiresAt,
    };
    const account = (
      await listSnapchatAdsAccounts({
        accessToken: usableGrant.accessToken,
      })
    ).find((item) => item.accountId === parsed.data.accountId);
    if (!account)
      return NextResponse.json(
        { error: 'Snapchat Ads account is not accessible' },
        { status: 400 }
      );
    const result = await credentialSupabase.rpc('set_merchant_ads_account', {
      p_account_timezone: account.timezoneName,
      p_attribution_metadata: {
        currencyCode: account.currencyCode,
        organizationId: account.organizationId,
        providerVersion: 'v1',
      },
      p_expected_access_token_ciphertext: usableGrant.accessTokenCiphertext,
      p_merchant_id: access.merchantId,
      p_provider: SNAPCHAT_ADS_PROVIDER,
      p_provider_account_label: account.label,
      p_provider_customer_id: account.accountId,
    });
    if (result.error)
      return NextResponse.json(
        { error: 'Failed to select Snapchat Ads account' },
        { status: 500 }
      );
    if (result.data !== true)
      return NextResponse.json(
        {
          error: 'Snapchat Ads authorization changed; retry account selection',
        },
        { status: 409 }
      );
    invalidateAdsAnalyticsCache(access.merchantId);
    return NextResponse.json({ accountId: account.accountId, selected: true });
  } catch (error) {
    return (
      (await revoked(error, current, access.merchantId, credentialSupabase)) ??
      providerFailure(error)
    );
  }
}
