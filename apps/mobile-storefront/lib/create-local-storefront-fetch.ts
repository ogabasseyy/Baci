import { getLocalStorefrontStoragePrefix } from './local-storefront-storage-prefix';

interface LocalFetchOptions {
  apiOrigin: string;
  supabaseOrigin: string;
  token: string;
  anonKey: string;
  expectedAuthIssuer: string;
}

function isLocalAuthorization(
  value: string,
  options: LocalFetchOptions
): boolean {
  if (value === `Bearer ${options.anonKey}`) return true;
  try {
    if (!value.startsWith('Bearer ')) return false;
    const encoded = value.slice(7).split('.')[1];
    const payload = JSON.parse(
      atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    );
    if (payload.role !== 'authenticated' || typeof payload.iss !== 'string')
      return false;
    return payload.iss === options.expectedAuthIssuer;
  } catch {
    return false;
  }
}

export function createLocalStorefrontFetch(
  transport: typeof fetch,
  options: LocalFetchOptions
): typeof fetch {
  getLocalStorefrontStoragePrefix({
    mode: '1',
    apiUrl: options.apiOrigin,
    supabaseUrl: options.supabaseOrigin,
  });
  if (!/^[a-f0-9]{48}$/.test(options.token) || !options.anonKey)
    throw new Error('Invalid local transport configuration');
  const issuerPort = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/auth\/v1$/.exec(
    options.expectedAuthIssuer
  );
  if (!issuerPort || Number(issuerPort[1]) > 65535)
    throw new Error('Invalid local Auth issuer');
  const origins = new Set([
    new URL(options.apiOrigin).origin,
    new URL(options.supabaseOrigin).origin,
  ]);
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!origins.has(url.origin) || url.username || url.password)
      throw new Error('Local storefront blocked a non-local request');
    const headers = new Headers(request.headers);
    const authorization = headers.get('authorization');
    if (authorization && !isLocalAuthorization(authorization, options))
      throw new Error('Local storefront blocked non-local authorization');
    if (headers.has('apikey') && headers.get('apikey') !== options.anonKey)
      throw new Error('Local storefront blocked a non-local API key');
    if (headers.has('cookie') || headers.has('proxy-authorization'))
      throw new Error('Local storefront blocked inherited credentials');
    headers.set('x-baci-local-test', options.token);
    const response = await transport(request, {
      headers,
      credentials: 'omit',
      redirect: 'error',
    });
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== url.origin)
    )
      throw new Error('Local storefront blocked a redirected response');
    return response;
  };
}
