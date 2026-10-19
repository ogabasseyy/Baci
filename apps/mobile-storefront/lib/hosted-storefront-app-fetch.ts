import { isHostedExpoPushRegistrationRequest } from './hosted-storefront-configuration';
import { isHostedStagingTestPaymentsEnabled } from './is-hosted-staging-wallet-top-up-blocked';

const AUTHENTICATED_SAVINGS_RPCS = new Set([
  'get_customer_savings_earnings',
  'get_customer_savings_notifications',
  'mark_customer_savings_notification_read',
  'register_push_token',
  'update_customer_savings_notification_preferences',
]);

function isExactAuthenticatedRpc(request: Request, url: URL): boolean {
  if (
    request.method !== 'POST' ||
    url.origin !== 'https://staging-auth.ogabassey.com' ||
    !url.pathname.startsWith('/rest/v1/rpc/')
  )
    return false;
  return AUTHENTICATED_SAVINGS_RPCS.has(
    url.pathname.slice('/rest/v1/rpc/'.length)
  );
}

async function isPushTokenDeactivation(request: Request, url: URL) {
  if (
    request.method !== 'PATCH' ||
    url.origin !== 'https://staging-auth.ogabassey.com' ||
    url.pathname !== '/rest/v1/push_tokens' ||
    url.searchParams.size !== 1
  )
    return false;
  const tokenFilter = url.searchParams.get('token');
  if (!tokenFilter?.startsWith('eq.') || tokenFilter.length === 3) return false;
  try {
    const body: unknown = JSON.parse(await request.clone().text());
    return (
      !!body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      'is_active' in body &&
      body.is_active === false
    );
  } catch {
    return false;
  }
}

export function createHostedStorefrontAppFetch(
  transport: typeof fetch
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const firstCardCheckout =
      url.pathname === '/api/storefront/customer/savings/card-checkout';
    const expoPushRegistration = isHostedExpoPushRegistrationRequest(
      url,
      request.method
    );
    const read =
      (request.method === 'GET' ||
        (request.method === 'HEAD' && !firstCardCheckout)) &&
      url.origin !== 'https://exp.host';
    const auth =
      request.method === 'POST' &&
      ((url.origin === 'https://staging-auth.ogabassey.com' &&
        [
          '/auth/v1/token',
          '/auth/v1/logout',
          '/auth/v1/otp',
          '/auth/v1/verify',
        ].includes(url.pathname)) ||
        (url.origin === 'https://staging.ogabassey.com' &&
          [
            '/api/storefront/auth/send-code',
            '/api/storefront/auth/verify-code',
            '/api/storefront/auth/session',
            '/api/storefront/auth/logout',
          ].includes(url.pathname)));
    const draft =
      request.method === 'POST' &&
      url.origin === 'https://staging.ogabassey.com' &&
      [
        '/api/storefront/customer/savings/drafts',
        '/api/storefront/customer/savings/drafts/policy',
      ].includes(url.pathname);
    const approvedSavingsPost =
      request.method === 'POST' &&
      url.origin === 'https://staging.ogabassey.com' &&
      [
        '/api/storefront/customer/savings/goals',
        '/api/storefront/customer/savings/funding',
      ].includes(url.pathname);
    const stagingTestPaymentPost =
      isHostedStagingTestPaymentsEnabled() &&
      request.method === 'POST' &&
      url.origin === 'https://staging.ogabassey.com' &&
      [
        '/api/storefront/customer/wallet/top-up/initialize',
        '/api/storefront/customer/wallet/top-up/confirm',
        '/api/storefront/customer/savings/contributions/manual',
        '/api/storefront/customer/savings/card-contributions',
      ].includes(url.pathname);
    const stagingFirstCardMutation =
      firstCardCheckout &&
      isHostedStagingTestPaymentsEnabled() &&
      ['POST', 'PATCH'].includes(request.method) &&
      url.origin === 'https://staging.ogabassey.com';
    const variantRead =
      request.method === 'POST' &&
      url.origin === 'https://staging-auth.ogabassey.com' &&
      url.pathname === '/rest/v1/rpc/get_storefront_product_variants';
    const savingsNotificationsPatch =
      request.method === 'PATCH' &&
      url.origin === 'https://staging.ogabassey.com' &&
      url.pathname === '/api/storefront/customer/savings/notifications';
    const authenticatedRpc = isExactAuthenticatedRpc(request, url);
    const pushTokenDeactivation = await isPushTokenDeactivation(request, url);
    if (
      (!read &&
        !auth &&
        !draft &&
        !approvedSavingsPost &&
        !stagingTestPaymentPost &&
        !stagingFirstCardMutation &&
        !variantRead &&
        !savingsNotificationsPatch &&
        !authenticatedRpc &&
        !pushTokenDeactivation &&
        !expoPushRegistration) ||
      (url.pathname.startsWith('/rest/v1/rpc/') &&
        !variantRead &&
        !authenticatedRpc) ||
      (expoPushRegistration &&
        (request.headers.has('apikey') || request.headers.has('authorization')))
    )
      throw new Error('Hosted staging financial operations are disabled');
    return await transport(request, init);
  };
}
