import { z } from 'zod';
import { decodeBase64UrlToUtf8 } from './cart/base64url';
import type { OxygenStagingProfile } from './oxygen-staging-profile';

const apiRoutes: Record<string, readonly string[]> = {
  '/api/orders': ['POST'],
  '/api/csrf': ['GET'],
  '/api/shipping/locations': ['GET'],
  '/api/shipping/quotes': ['POST'],
  '/api/storefront/customer/savings/goals': ['GET'],
  '/api/payments/oxygen/mobile-capabilities': ['GET'],
  '/api/payments/oxygen/workflows': ['GET', 'POST'],
  '/api/payments/oxygen/workflows/actions': ['GET', 'POST'],
  '/api/payments/oxygen/workflows/selfie-status': ['GET'],
  '/api/payments/oxygen/workflows/address-recovery': ['POST'],
  '/api/payments/oxygen/workflows/phone-recovery': ['POST'],
  '/api/payments/oxygen/draft': ['GET', 'PUT'],
  '/api/payments/oxygen/bank-details': ['POST'],
  '/api/payments/oxygen/residential-context': ['GET'],
  '/api/payments/oxygen/approval-code': ['GET'],
  '/api/payments/oxygen/recovery': ['GET', 'POST'],
  '/api/payments/oxygen/reconcile': ['POST'],
  '/api/places/autocomplete': ['GET'],
  '/api/places/details': ['GET'],
};
const catalogTables = new Set([
  'merchants',
  'merchant_feature_settings',
  'products',
  'product_variants',
  'categories',
  'product_categories',
  'shipping_settings',
  'page_configs',
]);
const ownedReadTables = new Set(['customers', 'orders', 'order_items']);
const catalogReadRpcs = new Set([
  'get_storefront_product_variants',
  'get_storefront_product_base_inventory',
  'get_storefront_offer_resolution',
  'get_storefront_payment_settings',
  'get_order_variant_overrides',
  'search_products_v2',
]);

// Client-side shape and expiry prefilter. The server verifies the token.
function hasExpectedStagingTokenClaims(
  value: string,
  profile: OxygenStagingProfile
): boolean {
  try {
    if (!value.startsWith('Bearer ') || value.length > 16384) return false;
    const segments = value.slice(7).split('.');
    if (segments.length !== 3) return false;
    const payload = JSON.parse(decodeBase64UrlToUtf8(segments[1]));
    return (
      payload.iss === profile.expectedAuthIssuer &&
      payload.role === 'authenticated' &&
      !('ref' in payload) &&
      !('project_ref' in payload) &&
      typeof payload.sub === 'string' &&
      !!payload.sub &&
      typeof payload.exp === 'number' &&
      payload.exp > Date.now() / 1000
    );
  } catch {
    return false;
  }
}

function isStagingWorkflowLookup(params: URLSearchParams): boolean {
  const expectedKeys = [
    'select',
    'environment',
    'order_id',
    'customer_id',
    'merchant_id',
  ];
  let count = 0;
  params.forEach(() => {
    count++;
  });
  return (
    count === expectedKeys.length &&
    expectedKeys.every((key) => params.getAll(key).length === 1) &&
    params.get('select') === 'id' &&
    params.get('environment') === 'eq.staging' &&
    ['order_id', 'customer_id', 'merchant_id'].every((key) => {
      const filter = params.get(key);
      return (
        filter?.startsWith('eq.') && z.uuid().safeParse(filter.slice(3)).success
      );
    })
  );
}

export function createOxygenStagingFetch(
  transport: typeof fetch,
  profile: OxygenStagingProfile
): typeof fetch {
  const authPrefix = new URL(profile.authBaseUrl).pathname.replace(/\/$/, '');
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    const authorization = headers.get('authorization');
    const hasSignedInClaims = hasExpectedStagingTokenClaims(
      authorization ?? '',
      profile
    );
    const isApi = url.origin === profile.apiOrigin;
    const isAuth =
      url.origin === profile.authOrigin &&
      (!authPrefix || url.pathname.startsWith(`${authPrefix}/`));
    const authRelativePath = isAuth
      ? url.pathname.slice(authPrefix.length)
      : '';
    const method = request.method.toUpperCase();
    const authPath =
      /^\/auth\/v1\/(token|user|logout|otp|verify|recover)$/.exec(
        authRelativePath
      )?.[1];
    const table = /^\/rest\/v1\/([a-z_]+)$/.exec(authRelativePath)?.[1];
    const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z_0-9]*)$/.exec(
      authRelativePath
    )?.[1];
    const allowedApi = isApi && apiRoutes[url.pathname]?.includes(method);
    const canReadOwnedTable =
      table &&
      hasSignedInClaims &&
      (ownedReadTables.has(table) ||
        (table === 'oxygen_workflows' &&
          isStagingWorkflowLookup(url.searchParams)));
    const allowedAuth =
      isAuth &&
      ((authPath &&
        (authPath === 'user'
          ? ['GET', 'PUT'].includes(method)
          : method === 'POST')) ||
        (table &&
          (catalogTables.has(table) || canReadOwnedTable) &&
          ['GET', 'HEAD'].includes(method)) ||
        (rpc && catalogReadRpcs.has(rpc) && method === 'POST'));
    const allowed = allowedApi || allowedAuth;
    if (
      !allowed ||
      url.username ||
      url.password ||
      url.hash ||
      ['access_token', 'refresh_token', 'apikey', 'authorization'].some((key) =>
        url.searchParams.has(key)
      ) ||
      ['cookie', 'cookie2', 'proxy-authorization', 'x-baci-local-test'].some(
        (key) => headers.has(key)
      ) ||
      (headers.has('apikey') && headers.get('apikey') !== profile.publicKey) ||
      (authorization &&
        !(allowedAuth && authorization === `Bearer ${profile.publicKey}`) &&
        !hasSignedInClaims) ||
      (allowedApi &&
        ![
          '/api/csrf',
          '/api/places/autocomplete',
          '/api/places/details',
          '/api/shipping/locations',
          '/api/shipping/quotes',
        ].includes(url.pathname) &&
        !hasSignedInClaims)
    )
      throw new Error('Oxygen staging blocked an unapproved request');
    const response = await transport(request, {
      headers,
      credentials: 'omit',
      redirect: 'error',
    });
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400) ||
      (response.url && response.url !== request.url)
    )
      throw new Error('Oxygen staging blocked a redirected response');
    return response;
  };
}
