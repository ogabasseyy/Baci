import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFrom,
  mockCheckStorefrontOtpVerifyLockout,
  mockLoggerError,
  mockLoggerWarn,
  mockRecordStorefrontOtpVerifyFailure,
  mockResolveStorefrontAuthMerchant,
  mockResetStorefrontOtpVerifyFailures,
  mockRpc,
  mockUpdateUser,
  mockVerifyOtp,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCheckStorefrontOtpVerifyLockout: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockRecordStorefrontOtpVerifyFailure: vi.fn(),
  mockResolveStorefrontAuthMerchant: vi.fn(),
  mockResetStorefrontOtpVerifyFailures: vi.fn(),
  mockRpc: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockVerifyOtp: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      updateUser: mockUpdateUser,
      verifyOtp: mockVerifyOtp,
    },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/storefront-auth-abuse', () => ({
  checkStorefrontOtpVerifyLockout: (...args: unknown[]) =>
    mockCheckStorefrontOtpVerifyLockout(...args),
  recordStorefrontOtpVerifyFailure: (...args: unknown[]) =>
    mockRecordStorefrontOtpVerifyFailure(...args),
  resetStorefrontOtpVerifyFailures: (...args: unknown[]) =>
    mockResetStorefrontOtpVerifyFailures(...args),
}));

vi.mock('../resolve-storefront-auth-merchant', () => ({
  resolveStorefrontAuthMerchant: (...args: unknown[]) =>
    mockResolveStorefrontAuthMerchant(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import { POST } from './route';

const merchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
};

function makeRequest(body: Record<string, unknown>) {
  return new Request('https://example.com/api/storefront/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/storefront/auth/verify-code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveStorefrontAuthMerchant.mockResolvedValue(merchant);
    mockCheckStorefrontOtpVerifyLockout.mockResolvedValue({
      locked: false,
      limit: 10,
      remaining: 10,
      resetTime: Date.now() + 86_400_000,
    });
    mockRecordStorefrontOtpVerifyFailure.mockResolvedValue({
      locked: false,
      limit: 10,
      remaining: 9,
      resetTime: Date.now() + 86_400_000,
    });
    mockResetStorefrontOtpVerifyFailures.mockResolvedValue(undefined);
    mockUpdateUser.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'customer-1', error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'customer-1',
                email: 'customer@example.com',
                full_name: 'Customer',
                phone: null,
                saved_addresses: [],
                total_orders: 0,
                total_spent: 0,
              },
            }),
          })),
        })),
      })),
    });
  });

  it('returns 404 when the storefront merchant resolver misses', async () => {
    mockResolveStorefrontAuthMerchant.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'missing-store',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Store not found' });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('returns 429 before verifying when the identifier is locked out', async () => {
    mockCheckStorefrontOtpVerifyLockout.mockResolvedValueOnce({
      locked: true,
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + 86_400_000,
    });

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error:
        'Too many failed verification attempts. Please request a new code later.',
    });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('returns 500 when the storefront merchant resolver fails', async () => {
    mockResolveStorefrontAuthMerchant.mockRejectedValue(
      new Error('RPC unavailable')
    );

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal server error' });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('logs expired customer OTP attempts as warnings while returning the existing 400 response', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired or is invalid' },
    });

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Verification code has expired. Please request a new one.',
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'OTP verification error',
        email: 'cus***@example.com',
      })
    );
    expect(mockRecordStorefrontOtpVerifyFailure).toHaveBeenCalledWith({
      email: 'customer@example.com',
      merchantId: 'merchant-1',
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('keeps unexpected OTP verification failures at error level', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Supabase auth service unavailable' },
    });

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );

    expect(response.status).toBe(400);
    expect(mockRecordStorefrontOtpVerifyFailure).toHaveBeenCalledWith({
      email: 'customer@example.com',
      merchantId: 'merchant-1',
    });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'OTP verification error',
        email: 'cus***@example.com',
      })
    );
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns a web session without refresh token after successful verification', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          expires_at: 1_900_000_000,
          expires_in: 3600,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        },
        user: {
          id: 'user-1',
          email: 'customer@example.com',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    });

    const response = await POST(
      makeRequest({
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResetStorefrontOtpVerifyFailures).toHaveBeenCalledWith({
      email: 'customer@example.com',
      merchantId: 'merchant-1',
    });
    expect(body.session).toEqual({
      access_token: 'access-token',
      expires_at: 1_900_000_000,
    });
  });

  it('returns the full session only for native verification handoff', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          expires_at: 1_900_000_000,
          expires_in: 3600,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        },
        user: {
          id: 'user-1',
          email: 'customer@example.com',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    });

    const response = await POST(
      makeRequest({
        audience: 'native',
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 1_900_000_000,
    });
  });

  it('returns 500 for native verification when Supabase omits refresh token', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          expires_at: 1_900_000_000,
          expires_in: 3600,
          token_type: 'bearer',
        },
        user: {
          id: 'user-1',
          email: 'customer@example.com',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    });

    const response = await POST(
      makeRequest({
        audience: 'native',
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Authentication failed. Please try again.',
    });
  });

  it('ignores a spoofed audience=native from a browser origin and returns a web session', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          expires_at: 1_900_000_000,
          expires_in: 3600,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        },
        user: {
          id: 'user-1',
          email: 'customer@example.com',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    });

    const request = new Request(
      'https://example.com/api/storefront/auth/verify-code',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'https://ogabassey.usebaci.com',
        },
        body: JSON.stringify({
          audience: 'native',
          email: 'customer@example.com',
          token: '123456',
          merchantSlug: 'ogabassey',
        }),
      }
    );
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session).toEqual({
      access_token: 'access-token',
      expires_at: 1_900_000_000,
    });
    expect(body.session.refresh_token).toBeUndefined();
    const setCookieHeader = response.headers.get('set-cookie');
    expect(setCookieHeader).toContain('baci_customer_session_hint=1');
    expect(setCookieHeader).toContain('Path=/');
    expect(setCookieHeader).toContain('Max-Age=2592000');
    expect(setCookieHeader).toContain('SameSite=lax');
    expect(setCookieHeader).toContain('Secure');
  });

  it('does not set baci_customer_session_hint cookie for native audience', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          expires_at: 1_900_000_000,
          expires_in: 3600,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        },
        user: {
          id: 'user-1',
          email: 'customer@example.com',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    });

    const response = await POST(
      makeRequest({
        audience: 'native',
        email: 'customer@example.com',
        token: '123456',
        merchantSlug: 'ogabassey',
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
