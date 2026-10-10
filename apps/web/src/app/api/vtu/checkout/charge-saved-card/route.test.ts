import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/vtu/checkout/charge-saved-card',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

const validPayload = {
  merchantSlug: 'ogabassey',
  amount: 1000,
  gateway: 'paystack',
  savedPaymentMethodId: '550e8400-e29b-41d4-a716-446655440000',
  type: 'airtime',
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
};

describe('POST /api/vtu/checkout/charge-saved-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'user-1', email: 'customer@example.com' },
      error: null,
      supabase: {},
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await POST(makeRequest(validPayload));

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid input', async () => {
    const response = await POST(makeRequest({ amount: 1000 }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
  });

  it('rejects saved-card charges so utilities go through the wallet instead', async () => {
    const response = await POST(makeRequest(validPayload));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
    expect(data.error).toMatch(/fund your wallet/i);
  });

  it('rejects saved-card charges with a partial walletAmount the same way', async () => {
    const response = await POST(
      makeRequest({ ...validPayload, walletAmount: 300 })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
  });
});
