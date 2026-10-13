const CONFIGURATION_KEYS = [
  'mode',
  'apiOrigin',
  'supabaseOrigin',
  'expectedAuthIssuer',
  'merchantId',
];

export const HOSTED_EXPO_PUSH_ORIGIN = 'https://exp.host';

const HOSTED_EXPO_PUSH_PATHS = new Set([
  '/--/api/v2/push/getExpoPushToken',
  '/--/api/v2/push/updateDeviceToken',
]);

export function isHostedExpoPushRegistrationRequest(
  url: URL,
  method: string
): boolean {
  return (
    method === 'POST' &&
    url.origin === HOSTED_EXPO_PUSH_ORIGIN &&
    url.search === '' &&
    HOSTED_EXPO_PUSH_PATHS.has(url.pathname)
  );
}

function stagingOrigin(value: unknown): string {
  const invalid = () =>
    new Error('Hosted staging requires an explicit canonical HTTPS DNS origin');
  if (typeof value !== 'string' || value.length > 253) throw invalid();
  const match = /^https:\/\/([a-z0-9.-]+)$/.exec(value);
  if (!match) throw invalid();
  const host = match[1];
  const labels = host.split('.');
  if (
    labels.length < 3 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ) ||
    !/^[a-z]{2,}$/.test(labels[labels.length - 1]) ||
    host === 'supabase.co' ||
    host.endsWith('.supabase.co') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    new URL(value).origin !== value
  )
    throw invalid();
  return value;
}

export function getHostedStorefrontConfiguration(
  input: unknown,
  development = typeof __DEV__ !== 'undefined' && __DEV__,
  trustedConfiguration: { supabaseOrigins: readonly string[] } = {
    supabaseOrigins: [],
  }
) {
  if (development !== true)
    throw new Error('Hosted storefront is development-only');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Explicit hosted staging configuration is required');
  if (
    Object.keys(input).length !== CONFIGURATION_KEYS.length ||
    CONFIGURATION_KEYS.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => !CONFIGURATION_KEYS.includes(key))
  )
    throw new Error(
      'Only explicit hosted staging configuration fields are permitted'
    );
  if (!('mode' in input) || input.mode !== 'hosted-staging')
    throw new Error('Explicit hosted-staging mode is required');
  if (
    !('apiOrigin' in input) ||
    !('supabaseOrigin' in input) ||
    !('expectedAuthIssuer' in input) ||
    !('merchantId' in input)
  )
    throw new Error('Incomplete hosted staging configuration');
  const apiOrigin = stagingOrigin(input.apiOrigin);
  const supabaseOrigin = stagingOrigin(input.supabaseOrigin);
  if (apiOrigin !== 'https://staging.ogabassey.com')
    throw new Error('API origin is not the trusted staging API');
  const supabaseHost = new URL(supabaseOrigin).hostname;
  if (
    ['ogabassey.com', 'usebaci.com', 'usebaci.app'].some((domain) =>
      [domain, `www.${domain}`, `api.${domain}`].includes(supabaseHost)
    )
  )
    throw new Error(
      'Supabase must use an isolated operator-approved VPS origin'
    );
  if (
    !Array.isArray(trustedConfiguration?.supabaseOrigins) ||
    !trustedConfiguration.supabaseOrigins.includes(supabaseOrigin)
  )
    throw new Error(
      'Supabase origin requires a separate explicit operator allowlist'
    );
  if (apiOrigin === supabaseOrigin)
    throw new Error('API and Supabase origins must be distinct');
  if (input.expectedAuthIssuer !== `${supabaseOrigin}/auth/v1`)
    throw new Error(
      'Explicit Auth issuer must match the staging Supabase origin and /auth/v1'
    );
  if (
    typeof input.merchantId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      input.merchantId
    )
  )
    throw new Error('Explicit staging merchant UUID is required');
  const namespace = [supabaseOrigin, apiOrigin, input.merchantId]
    .map((value) => `${value.length}-${value.replace('https://', '')}`)
    .join('_');
  return Object.freeze({
    mode: 'hosted-staging' as const,
    apiOrigin,
    supabaseOrigin,
    expectedAuthIssuer: input.expectedAuthIssuer,
    merchantId: input.merchantId,
    storagePrefix: `baci-hosted-staging-${namespace}.`,
    allowedOrigins: Object.freeze([
      apiOrigin,
      supabaseOrigin,
      HOSTED_EXPO_PUSH_ORIGIN,
    ]),
    requiresFullReload: true,
  });
}
