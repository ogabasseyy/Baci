import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { installLocalStorefrontRuntime } from './install-local-storefront-runtime';

const mockExtra: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  expoConfig: {
    get extra() {
      return mockExtra;
    },
    updates: { enabled: false },
  },
}));
jest.mock('./local-storefront-storage-prefix', () => ({
  getLocalStorefrontStoragePrefix: () => 'local.',
}));
const originalEnvironment = { ...process.env };
const originalFetch = global.fetch;
const runtime = globalThis as typeof globalThis & {
  __baciLocalStorefrontTransport?: unknown;
};

beforeEach(() => {
  delete runtime.__baciLocalStorefrontTransport;
  for (const key of Object.keys(mockExtra)) delete mockExtra[key];
  Object.assign(process.env, {
    EXPO_PUBLIC_LOCAL_AUTH_ISSUER: 'http://127.0.0.1:55431/auth/v1',
    EXPO_PUBLIC_API_URL: 'http://192.168.100.70:4193',
    EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.100.70:4192',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'local-anon',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-anon',
    EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN: 'a'.repeat(48),
    EXPO_PUBLIC_MERCHANT_ID: 'local-merchant',
    EXPO_PUBLIC_SENTRY_DSN: '',
  });
  Object.assign(mockExtra, {
    localAuthIssuer: 'http://127.0.0.1:55431/auth/v1',
    localStorefront: true,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: 'local-anon',
    supabasePublishableKey: 'local-anon',
    merchantId: 'local-merchant',
  });
});
afterEach(() => {
  process.env = { ...originalEnvironment };
  global.fetch = originalFetch;
  delete runtime.__baciLocalStorefrontTransport;
});

it('installs the capability guard before an SDK captures global fetch', async () => {
  const transport = jest
    .fn<FetchImplementation>()
    .mockResolvedValue(new Response('{}'));
  global.fetch = transport;
  installLocalStorefrontRuntime();
  const sdkCapturedFetch = global.fetch;
  await sdkCapturedFetch('http://192.168.100.70:4192/rest/v1/merchants');
  expect(
    new Headers(transport.mock.calls[0][1]?.headers).get('x-baci-local-test')
  ).toBe('a'.repeat(48));
  installLocalStorefrontRuntime();
  expect(global.fetch).toBe(sdkCapturedFetch);
  process.env.EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN = 'b'.repeat(48);
  expect(installLocalStorefrontRuntime).toThrow('Fully reload');
});

it.each([
  { localAuthIssuer: 'http://127.0.0.1:54321/auth/v1' },
  { apiUrl: 'https://production.invalid' },
  { supabasePublishableKey: 'hosted-key' },
  { posthogApiKey: 'production' },
  { facebookClientToken: 'production' },
  { tiktokBusiness: { isConfigured: true } },
  { eas: { projectId: 'production' } },
])('rejects production build extras %j before installing transport', (extra) => {
  Object.assign(mockExtra, extra);
  expect(installLocalStorefrontRuntime).toThrow(
    'sanitized local Expo manifest'
  );
  expect(global.fetch).toBe(originalFetch);
});
