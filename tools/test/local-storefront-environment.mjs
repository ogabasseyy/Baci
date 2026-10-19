import { isIPv4 } from 'node:net';

const HOST_ENVIRONMENT_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'SHELL',
  'LANG',
];
const DISABLED_CONFIGURATION_NAMES = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_POSTHOG_API_KEY',
  'STOREFRONT_FACEBOOK_APP_ID',
  'STOREFRONT_FACEBOOK_CLIENT_TOKEN',
  'STOREFRONT_TIKTOK_APP_SECRET',
];

function privateLanOrigin(value, name) {
  const invalid = () =>
    new Error(
      `${name} must be an explicit private IPv4 LAN HTTP(S) origin with a port`
    );
  if (typeof value !== 'string') throw invalid();
  const match = /^(https?):\/\/([0-9.]+):([1-9][0-9]{0,4})\/?$/.exec(value);
  if (!match || !isIPv4(match[2]) || Number(match[3]) > 65535) throw invalid();
  const [first, second] = match[2].split('.').map(Number);
  if (
    !(
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    )
  ) {
    throw invalid();
  }
  return `${match[1]}://${match[2]}:${match[3]}`;
}

function localAnonKey(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw new Error();
    const segments = value.split('.');
    if (
      segments.length !== 3 ||
      segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
    )
      throw new Error();
    const decoded = segments.map((segment) =>
      Buffer.from(segment, 'base64url')
    );
    if (
      decoded.some(
        (segment, index) => segment.toString('base64url') !== segments[index]
      )
    )
      throw new Error();
    const header = JSON.parse(decoded[0].toString('utf8'));
    const payload = JSON.parse(decoded[1].toString('utf8'));
    if (
      header.alg !== 'HS256' ||
      header.typ !== 'JWT' ||
      decoded[2].length !== 32 ||
      payload.role !== 'anon' ||
      payload.iss !== 'supabase-demo' ||
      'ref' in payload ||
      'project_ref' in payload
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      'supabaseAnonKey must be a public local Supabase anon JWT (HS256, issuer supabase-demo); hosted, user, and privileged keys are forbidden'
    );
  }
}

export function buildLocalStorefrontEnvironment(options, source = {}) {
  const apiOrigin = privateLanOrigin(options?.apiOrigin, 'apiOrigin');
  const supabaseOrigin = privateLanOrigin(
    options?.supabaseOrigin,
    'supabaseOrigin'
  );
  if (apiOrigin === supabaseOrigin)
    throw new Error('API and Supabase must have distinct origins');
  const anonKey = localAnonKey(options?.supabaseAnonKey);
  const issuerPort =
    typeof options.expectedAuthIssuer === 'string' &&
    /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/auth\/v1$/.exec(
      options.expectedAuthIssuer
    );
  if (!issuerPort || Number(issuerPort[1]) > 65535)
    throw new Error(
      'expectedAuthIssuer must be the explicit loopback Auth issuer URL'
    );
  if (
    typeof options.token !== 'string' ||
    !/^[a-f0-9]{48}$/.test(options.token)
  )
    throw new Error('token must be an explicit 48-hex local relay capability');
  if (
    typeof options.merchantId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      options.merchantId
    )
  )
    throw new Error('merchantId must be an explicit local merchant UUID');
  const namespaceOrigin = (origin) =>
    origin.replace('://', '-').replace(':', '-');
  const storagePrefix = `baci-local-${namespaceOrigin(supabaseOrigin)}-${namespaceOrigin(apiOrigin)}.`;
  const environment = {};
  for (const name of HOST_ENVIRONMENT_NAMES) {
    if (
      Object.hasOwn(source, name) &&
      typeof source[name] === 'string' &&
      !/[\r\n\0]/.test(source[name])
    ) {
      environment[name] = source[name];
    }
  }
  for (const name of DISABLED_CONFIGURATION_NAMES) environment[name] = '';
  Object.assign(environment, {
    NODE_ENV: 'development',
    BABEL_ENV: 'development',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_OFFLINE: '1',
    EXPO_PUBLIC_PHONE_QA: '0',
    EXPO_PUBLIC_LOCAL_STOREFRONT: '1',
    EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN: options.token,
    EXPO_PUBLIC_LOCAL_AUTH_ISSUER: options.expectedAuthIssuer,
    EXPO_PUBLIC_MERCHANT_ID: options.merchantId,
    EXPO_UPDATE_CHANNEL: 'development',
    EXPO_PUBLIC_API_URL: apiOrigin,
    EXPO_PUBLIC_STOREFRONT_API_URL: apiOrigin,
    EXPO_PUBLIC_SUPABASE_URL: supabaseOrigin,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    EXPO_PUBLIC_MERCHANT_DOMAIN: new URL(apiOrigin).host,
    EXPO_PUBLIC_POSTHOG_HOST: apiOrigin,
    EXPO_PUBLIC_SENTRY_ENVIRONMENT: 'local',
    EXPO_PUBLIC_QUIZ_ADS_ENABLED: 'false',
  });
  return Object.freeze({
    environment: Object.freeze(environment),
    entryPoint: 'expo-router/entry',
    storagePrefix,
    authStorageKey: `${storagePrefix}sb-${new URL(supabaseOrigin).hostname.split('.')[0]}-auth-token`,
    launchReady: true,
    blockers: Object.freeze([]),
    requiresFullReload: true,
  });
}
