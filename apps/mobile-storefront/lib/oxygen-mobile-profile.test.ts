import { CONFIG } from './config';
import { getOxygenMobileProfile } from './oxygen-mobile-profile';
import { getOxygenStagingProfile } from './oxygen-staging-profile';
import { getSupabaseRealtimeConfig } from './supabase';

jest.mock('./config', () => ({
  CONFIG: {
    MERCHANT_ID: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    MERCHANT_SLUG: 'ogabassey',
  },
}));
jest.mock('./oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(),
}));
jest.mock('./supabase', () => ({ getSupabaseRealtimeConfig: jest.fn() }));

const initialApiUrl = process.env.EXPO_PUBLIC_API_URL;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
  jest.mocked(getSupabaseRealtimeConfig).mockReturnValue({
    url: 'https://project.supabase.co',
    key: 'public-key',
  });
  delete process.env.EXPO_PUBLIC_API_URL;
});

afterEach(() => {
  if (initialApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = initialApiUrl;
});

it('uses the built storefront identity, canonical API and installed Auth URL', () => {
  expect(getOxygenMobileProfile()).toEqual({
    environment: 'production',
    apiOrigin: 'https://usebaci.com',
    authOrigin: 'https://project.supabase.co',
    authBaseUrl: 'https://project.supabase.co',
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: 'ogabassey',
    storagePrefix: 'oxygen-production:',
  });
});

it('preserves a validated staging profile and never reads production Auth for it', () => {
  const profile = { environment: 'staging' } as NonNullable<
    ReturnType<typeof getOxygenStagingProfile>
  >;
  jest.mocked(getOxygenStagingProfile).mockReturnValue(profile);
  expect(getOxygenMobileProfile()).toBe(profile);
  expect(getSupabaseRealtimeConfig).not.toHaveBeenCalled();
});

it('does not use a third-party checkout API', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://another.example.com';
  expect(getOxygenMobileProfile()).toBeNull();
});

it.each([
  null,
  'http://project.supabase.co',
  'https://project.supabase.co/path',
])('refuses an unconfigured or noncanonical Auth base %s', (url) => {
  jest
    .mocked(getSupabaseRealtimeConfig)
    .mockReturnValue(url === null ? null : { url, key: 'public-key' });
  expect(getOxygenMobileProfile()).toBeNull();
});
