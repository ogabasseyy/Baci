export interface PublicHomeRpcBinding {
  origin: string;
  publishableKey: string;
  merchantId: string;
}
/** Shared egress/CORS boundary: exactly one configured anonymous RPC and merchant. */
export function isBoundPublicHomeRpc(
  value: string,
  binding?: PublicHomeRpcBinding
) {
  const url = new URL(value);
  return Boolean(
    binding &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(binding.origin) &&
      url.origin === binding.origin &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.pathname === '/rest/v1/rpc/builder_public_home' &&
      url.searchParams.size === 1 &&
      url.searchParams.get('p_merchant') === binding.merchantId
  );
}
export function publicHomeRpcCors(expectedOrigin: string) {
  return {
    'access-control-allow-origin': expectedOrigin,
    'access-control-allow-methods': 'GET',
    'access-control-allow-headers':
      'apikey, authorization, content-type, x-client-info, accept-profile, prefer, x-supabase-api-version',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}
export function allowedPublicHomePreflight(
  headers: Record<string, string>,
  expectedOrigin: string
) {
  const requested = headers['access-control-request-headers'] ?? '';
  const allowed = new Set(
    publicHomeRpcCors(expectedOrigin)['access-control-allow-headers'].split(
      ', '
    )
  );
  return (
    headers.origin === expectedOrigin &&
    headers['access-control-request-method'] === 'GET' &&
    requested.length <= 1024 &&
    requested
      .split(',')
      .filter(Boolean)
      .every((name) => allowed.has(name.trim().toLowerCase()))
  );
}
