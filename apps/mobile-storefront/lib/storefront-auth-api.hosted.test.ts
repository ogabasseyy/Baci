import { sendStorefrontOtp, verifyStorefrontOtp } from './storefront-auth-api';

const mockSend = jest.fn();
const mockVerify = jest.fn();
jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://staging.ogabassey.com',
  EXPO_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
}));
jest.mock('./config', () => ({
  CONFIG: { MERCHANT_SLUG: 'savings-synthetic' },
}));
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSend(...args),
      verifyOtp: (...args: unknown[]) => mockVerify(...args),
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  global.fetch = jest
    .fn()
    .mockResolvedValue(new Response('NOT_FOUND', { status: 404 }));
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
});

it('sends hosted sandbox OTP through its verified auth client instead of the missing storefront route', async () => {
  mockSend.mockResolvedValue({ data: {}, error: null });
  expect(await sendStorefrontOtp('fresh@example.com')).toEqual({
    success: true,
    data: undefined,
  });
  expect(mockSend).toHaveBeenCalledWith({
    email: 'fresh@example.com',
    options: { shouldCreateUser: false },
  });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('verifies the emailed code through normal hosted auth and requires a complete session', async () => {
  mockVerify.mockResolvedValue({
    data: {
      session: { access_token: 'test-access', refresh_token: 'test-refresh' },
    },
    error: null,
  });
  expect(await verifyStorefrontOtp('fresh@example.com', '123456')).toEqual({
    success: true,
    data: expect.objectContaining({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    }),
  });
  expect(mockVerify).toHaveBeenCalledWith({
    email: 'fresh@example.com',
    token: '123456',
    type: 'email',
  });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('does not accept a rejected or incomplete hosted authentication session', async () => {
  mockVerify.mockResolvedValueOnce({
    data: { session: null },
    error: { message: 'Code expired' },
  });
  expect(await verifyStorefrontOtp('fresh@example.com', '123456')).toEqual({
    success: false,
    error: 'Code expired',
  });
  mockVerify.mockResolvedValueOnce({
    data: { session: { access_token: 'test-access' } },
    error: null,
  });
  expect(await verifyStorefrontOtp('fresh@example.com', '123456')).toEqual({
    success: false,
    error: 'Failed to verify OTP',
  });
});
