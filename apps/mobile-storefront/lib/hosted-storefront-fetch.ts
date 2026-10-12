import {
  getHostedStorefrontConfiguration,
  HOSTED_EXPO_PUSH_ORIGIN,
  isHostedExpoPushRegistrationRequest,
} from './hosted-storefront-configuration';

function jwtPayload(value: string): Record<string, unknown> {
  if (value.length > 8192) throw new Error();
  const segments = value.split('.');
  if (
    segments.length !== 3 ||
    segments.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    throw new Error();
  const decode = (part: string) =>
    atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  const header = JSON.parse(decode(segments[0]));
  const payload: unknown = JSON.parse(decode(segments[1]));
  if (
    !header ||
    !['HS256', 'RS256', 'ES256'].includes(header.alg) ||
    header.typ !== 'JWT' ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  )
    throw new Error();
  return payload as Record<string, unknown>;
}

function validPublicKey(value: string, issuer: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(value)) return true;
  try {
    const payload = jwtPayload(value);
    return (
      payload.role === 'anon' &&
      payload.iss === issuer &&
      !('ref' in payload) &&
      !('project_ref' in payload)
    );
  } catch {
    return false;
  }
}

export function createHostedStorefrontFetch(
  transport: typeof fetch,
  requestedConfiguration: unknown,
  trustedConfiguration: {
    supabaseOrigins: readonly string[];
    publicKey: string;
  },
  development = typeof __DEV__ !== 'undefined' && __DEV__
): typeof fetch {
  let configuration: ReturnType<typeof getHostedStorefrontConfiguration>;
  let publicKey: string;
  try {
    configuration = getHostedStorefrontConfiguration(
      requestedConfiguration,
      development,
      trustedConfiguration
    );
    publicKey = trustedConfiguration.publicKey;
    if (
      typeof publicKey !== 'string' ||
      !validPublicKey(publicKey, configuration.expectedAuthIssuer)
    )
      throw new Error();
  } catch {
    throw new Error('Invalid hosted staging transport configuration');
  }
  const origins = new Set(configuration.allowedOrigins);
  const issuer = configuration.expectedAuthIssuer;
  return async (input, init) => {
    try {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        !origins.has(url.origin) ||
        url.username ||
        url.password ||
        (url.origin === HOSTED_EXPO_PUSH_ORIGIN &&
          !isHostedExpoPushRegistrationRequest(url, request.method))
      )
        throw new Error();
      const headers = new Headers(request.headers);
      if (
        ['cookie', 'cookie2', 'proxy-authorization', 'x-baci-local-test'].some(
          (name) => headers.has(name)
        )
      )
        throw new Error();
      if (
        url.origin === HOSTED_EXPO_PUSH_ORIGIN &&
        (headers.has('apikey') || headers.has('authorization'))
      )
        throw new Error();
      if (headers.has('apikey') && headers.get('apikey') !== publicKey)
        throw new Error();
      if (headers.has('authorization')) {
        const authorization = headers.get('authorization') ?? '';
        if (!authorization.startsWith('Bearer ')) throw new Error();
        const token = authorization.slice(7);
        if (token !== publicKey) {
          const payload = jwtPayload(token);
          if (
            payload.role !== 'authenticated' ||
            payload.iss !== issuer ||
            typeof payload.sub !== 'string' ||
            !payload.sub ||
            typeof payload.exp !== 'number' ||
            !Number.isFinite(payload.exp) ||
            payload.exp <= Date.now() / 1000
          )
            throw new Error();
        }
      }
      const response = await transport(request, {
        headers,
        credentials: 'omit',
        redirect: 'error',
      });
      if (
        response.redirected ||
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400) ||
        (response.url && new URL(response.url).origin !== url.origin)
      )
        throw new Error();
      return response;
    } catch {
      throw new Error('Hosted staging request failed or was blocked');
    }
  };
}
