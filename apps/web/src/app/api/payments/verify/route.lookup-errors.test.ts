import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() => Promise.resolve({ valid: true })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

const mockGetAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) =>
    mockGetAuthenticatedUser(...args),
}));

import { POST } from './route';

const REFERENCE = 'BAC-VERIFY-1';

function createRequest() {
  return new NextRequest('http://localhost:3000/api/payments/verify', {
    body: JSON.stringify({ reference: REFERENCE }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function serviceClientFor(transactionResult: {
  data: unknown;
  error: unknown;
}) {
  return {
    from: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(transactionResult),
      select: vi.fn().mockReturnThis(),
    })),
  };
}

describe('verify route transaction lookup errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue(null);
  });

  it('returns a transient 503 when the transaction lookup errors', async () => {
    mockCreateServiceClient.mockReturnValue(
      serviceClientFor({ data: null, error: { message: 'connection reset' } })
    );

    const response = await POST(createRequest());
    const body = await response.json();

    // Native callers treat reference_not_found as permanent terminal
    // failure: an outage must never wear that code.
    expect(response.status).toBe(503);
    expect(body).toStrictEqual({ error: 'Verification unavailable' });
  });

  it('returns permanent reference_not_found for an error-free empty result', async () => {
    mockCreateServiceClient.mockReturnValue(
      serviceClientFor({ data: null, error: null })
    );

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toStrictEqual({
      error: 'Transaction not found',
      code: 'reference_not_found',
      reference: REFERENCE,
    });
  });
});
