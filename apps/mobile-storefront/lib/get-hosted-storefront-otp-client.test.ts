import { getHostedStorefrontOtpClient } from './get-hosted-storefront-otp-client';
import { supabase } from './supabase';

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: '',
  EXPO_PUBLIC_SUPABASE_URL: '',
}));
jest.mock('./supabase', () => ({
  supabase: { auth: { signInWithOtp: jest.fn(), verifyOtp: jest.fn() } },
}));
const originalDev = (globalThis as typeof globalThis & { __DEV__?: boolean })
  .__DEV__;
const pinned = {
  hostedMode: '1',
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://staging-auth.ogabassey.com',
};

beforeEach(() => {
  Reflect.set(globalThis, '__DEV__', true);
});
afterEach(() => {
  Reflect.set(globalThis, '__DEV__', originalDev);
});

it('never redirects production sign-in to the hosted sandbox', () => {
  Reflect.set(globalThis, '__DEV__', false);
  expect(getHostedStorefrontOtpClient(pinned)).toBeNull();
});

it('keeps ordinary development sign-in on its existing route', () => {
  expect(
    getHostedStorefrontOtpClient({ ...pinned, hostedMode: '0' })
  ).toBeNull();
});

it('reuses the existing public auth client only for exact sandbox origins', () => {
  expect(getHostedStorefrontOtpClient(pinned)).toBe(supabase.auth);
});

it.each([
  { ...pinned, apiOrigin: 'https://ogabassey.com' },
  { ...pinned, supabaseOrigin: 'https://other.example' },
  { ...pinned, apiOrigin: '' },
])('rejects mismatched hosted auth configuration', (configuration) => {
  expect(() => getHostedStorefrontOtpClient(configuration)).toThrow(
    'Hosted staging authentication is unavailable.'
  );
});
