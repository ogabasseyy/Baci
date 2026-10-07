import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://usebaci.com',
}));

jest.mock('./config', () => ({
  CONFIG: {
    MERCHANT_SLUG: 'ogabassey',
  },
}));

import { sendStorefrontOtp, verifyStorefrontOtp } from './storefront-auth-api';

const mockFetch = jest.fn<FetchImplementation>();

describe('storefront auth API client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  it('sends native OTP through the shared storefront endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const result = await sendStorefrontOtp('customer@example.com');

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/auth/send-code',
      expect.objectContaining({
        body: JSON.stringify({
          audience: 'native',
          email: 'customer@example.com',
          merchantSlug: 'ogabassey',
        }),
        method: 'POST',
      })
    );
  });

  it('requires a full native session from OTP verification responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          session: {
            access_token: 'access-token',
            expires_at: 1_900_000_000,
            expires_in: 3600,
            refresh_token: 'refresh-token',
            token_type: 'bearer',
          },
        }),
        { status: 200 }
      )
    );

    const result = await verifyStorefrontOtp('customer@example.com', '123456');

    expect(result).toEqual({
      success: true,
      data: {
        access_token: 'access-token',
        expires_at: 1_900_000_000,
        expires_in: 3600,
        refresh_token: 'refresh-token',
        token_type: 'bearer',
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/auth/verify-code',
      expect.objectContaining({
        body: JSON.stringify({
          audience: 'native',
          email: 'customer@example.com',
          merchantSlug: 'ogabassey',
          token: '123456',
        }),
      })
    );
  });

  it('returns API error messages for failed OTP responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
      })
    );

    const result = await sendStorefrontOtp('customer@example.com');

    expect(result).toEqual({ success: false, error: 'Too many requests' });
  });

  it('returns network errors for failed OTP send requests', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unavailable'));

    const result = await sendStorefrontOtp('customer@example.com');

    expect(result).toEqual({
      success: false,
      error: 'Network unavailable',
    });
  });

  it('rejects successful OTP send responses with invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not-json', { status: 200 }));

    const result = await sendStorefrontOtp('customer@example.com');

    expect(result).toEqual({ success: false, error: 'Failed to send OTP' });
  });

  it('rejects verify responses that omit the refresh token', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          session: { access_token: 'access-token' },
        }),
        { status: 200 }
      )
    );

    const result = await verifyStorefrontOtp('customer@example.com', '123456');

    expect(result).toEqual({ success: false, error: 'Failed to verify OTP' });
  });

  it('rejects verify responses that omit the access token', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          session: { refresh_token: 'refresh-token' },
        }),
        { status: 200 }
      )
    );

    const result = await verifyStorefrontOtp('customer@example.com', '123456');

    expect(result).toEqual({ success: false, error: 'Failed to verify OTP' });
  });

  it('rejects verify responses with a non-object native session', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          session: null,
        }),
        { status: 200 }
      )
    );

    const result = await verifyStorefrontOtp('customer@example.com', '123456');

    expect(result).toEqual({ success: false, error: 'Failed to verify OTP' });
  });
});
