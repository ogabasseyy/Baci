import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyOtp, mockHeaders } = vi.hoisted(() => ({
  mockVerifyOtp: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn(),
  }),
  headers: mockHeaders,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      verifyOtp: mockVerifyOtp,
    },
  })),
}));

import { GET } from '@/app/auth/confirm/route';

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    mockVerifyOtp.mockReset();
    mockHeaders.mockResolvedValue(new Headers());
  });

  it('redirects to login when the token hash is missing', async () => {
    const response = await GET(
      new Request('https://usebaci.com/auth/confirm?type=signup')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/login?error=Invalid%20confirmation%20link'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('redirects to login when the verification type is missing', async () => {
    const response = await GET(
      new Request('https://usebaci.com/auth/confirm?token_hash=hash-123')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/login?error=Invalid%20confirmation%20link'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('redirects custom-domain confirmation errors to storefront account login', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    const response = await GET(
      new Request('https://ogabassey.com/auth/confirm?type=signup')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/account/login?error=Invalid%20confirmation%20link'
    );
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('verifies the token hash and redirects to the safe next path', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=signup&next=https%3A%2F%2Fusebaci.com%2Finvite%2Ftoken-123%3Faccept%3D1'
      )
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: 'hash-123',
      type: 'signup',
    });
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/invite/token-123?accept=1'
    );
  });

  it('falls back to the default dashboard redirect when next is missing', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=signup'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard'
    );
  });

  it('defaults custom-domain confirms with no next to the account area, not /dashboard', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://ogabassey.com/auth/confirm?token_hash=hash-123&type=magiclink'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/account'
    );
  });

  it('blocks external next redirects and falls back to the dashboard', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=signup&next=https%3A%2F%2Fevil.example%2Fpwnd'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/dashboard'
    );
  });

  it('normalizes legacy update-password routes before redirecting', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=recovery&next=https%3A%2F%2Fusebaci.com%2Fauth%2Fupdate-password'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/update-password'
    );
  });

  it('allows redirects back into the mobile app', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=signup&next=baciadmin%3A%2F%2F'
      )
    );

    expect(response.headers.get('location')).toBe('baciadmin://');
  });

  it('redirects failed custom-domain confirmations to storefront account login', async () => {
    mockHeaders.mockResolvedValue(
      new Headers([['x-merchant-domain', 'ogabassey.com']])
    );
    mockVerifyOtp.mockResolvedValue({
      error: { message: 'OTP expired' },
    });

    const response = await GET(
      new Request(
        'https://ogabassey.com/auth/confirm?token_hash=hash-123&type=signup'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://ogabassey.com/account/login?error=OTP%20expired'
    );
  });

  it('redirects to login when Supabase verification fails', async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: 'OTP expired' },
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=signup'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/login?error=OTP%20expired'
    );
  });

  it('routes failed root-domain storefront confirms to the slug storefront login', async () => {
    // Root-domain storefront confirms stay on the platform host with a
    // slug-prefixed next; on failure the customer must reach the storefront
    // login, not the merchant /login.
    mockVerifyOtp.mockResolvedValue({
      error: { message: 'OTP expired' },
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=magiclink&next=%2Fogabassey%2Faccount%2Forders'
      )
    );

    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/ogabassey/account/login?error=OTP%20expired'
    );
  });

  it('clears the guest session hint cookie when confirmation succeeds', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        'https://usebaci.com/auth/confirm?token_hash=hash-123&type=magiclink&next=%2Fogabassey%2Faccount'
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://usebaci.com/ogabassey/account'
    );
    expect(response.headers.get('set-cookie')).toContain(
      'baci_customer_session_hint=;'
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
