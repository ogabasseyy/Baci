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
  return new NextRequest('http://localhost:3000/api/vtu/checkout/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  merchantSlug: 'ogabassey',
  amount: 1000,
  gateway: 'paystack',
  type: 'airtime',
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
};

describe('POST /api/vtu/checkout/initialize', () => {
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

  it('rejects gateway checkout so utilities go through the wallet instead', async () => {
    const response = await POST(makeRequest(validPayload));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
    expect(data.error).toMatch(/fund your wallet/i);
  });

  it('rejects the korapay gateway the same way', async () => {
    const response = await POST(
      makeRequest({ ...validPayload, gateway: 'korapay' })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
  });

  it('rejects the bank-transfer gateway the same way (fund the wallet DVA, then pay from wallet)', async () => {
    const response = await POST(
      makeRequest({ ...validPayload, gateway: 'bank_transfer' })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
    expect(data.error).toMatch(/fund your wallet/i);
  });

  it.each([
    { type: 'airtime', extra: {} },
    { type: 'data', extra: { dataPlanCode: 'MTN-DATA-1GB' } },
    {
      type: 'electricity',
      extra: {
        billItemIdentifier: 'PHED-PREPAID',
        customerIdentifier: '1234567890',
      },
    },
    {
      type: 'cable_tv',
      extra: {
        billItemIdentifier: 'DSTV-COMPACT',
        customerIdentifier: '1234567890',
      },
    },
    {
      type: 'betting',
      extra: {
        billItemIdentifier: 'BET9JA-TOPUP',
        customerIdentifier: '1234567890',
      },
    },
  ] as const)('rejects gateway checkout for $type purchases', async ({
    type,
    extra,
  }) => {
    const response = await POST(
      makeRequest({ ...validPayload, type, ...extra })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VTU_WALLET_ONLY');
  });
});
