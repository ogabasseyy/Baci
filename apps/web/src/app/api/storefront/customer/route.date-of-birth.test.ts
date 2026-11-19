import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';

// --- Mocks ---

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockCheckCsrfProtection = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

// --- Helpers ---

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/storefront/customer', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function mockChain(returnValue: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // The customer lookup filters live rows with .is('deleted_at', null).
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(returnValue),
    // The merchant lookup now goes through resolveMerchantIdBySlugOrAlias, which
    // uses maybeSingle (with a merchant_slug_aliases fallback on a miss).
    maybeSingle: vi.fn().mockResolvedValue(returnValue),
    update: vi.fn().mockReturnThis(),
  };
  return chain;
}

// Builds the PATCH update chain: .update().eq().is().select().maybeSingle().
// `matched` is the live row the write returned (null => no live row matched, i.e.
// the customer was soft-deleted between the lookup and the update).
function mockUpdateChain(matched: { id: string } | null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: matched, error: null }),
  };
  return chain;
}

// --- Tests ---

describe('PATCH /api/storefront/customer — date of birth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a valid CSRF token. Individual tests override to exercise the
    // rejection path.
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 400 when date_of_birth is not a real date', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      date_of_birth: '1990-02-30', // Feb 30 is not a real date
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
  });

  it('saves a valid date_of_birth (powers the quiz 18+ gate)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const merchantChain = mockChain({
      data: { id: 'merchant-1' },
      error: null,
    });
    const customerChain = mockChain({
      data: { id: 'customer-1' },
      error: null,
    });
    const updateChain = mockUpdateChain({ id: 'customer-1' });

    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return merchantChain;
      if (table === 'customers') {
        fromCallCount++;
        return fromCallCount === 1 ? customerChain : updateChain;
      }
      return merchantChain;
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      date_of_birth: '1990-06-15',
    });
    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ date_of_birth: '1990-06-15' })
    );
  });

  it('returns 404 without a phantom success when the row is soft-deleted before the write', async () => {
    // Regression (is6Tw7tN): the lookup found a live row, but the customer is
    // soft-deleted before the UPDATE lands. The write reasserts deleted_at IS
    // NULL and .select()s the affected row — zero rows match, so this must be a
    // 404, not a success that leaves the quiz gate closed on a row the server
    // then rejects with quiz_customer_not_found.
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const merchantChain = mockChain({
      data: { id: 'merchant-1' },
      error: null,
    });
    const customerChain = mockChain({
      data: { id: 'customer-1' },
      error: null,
    });
    // No live row matched the guarded update (soft-deleted between lookup/write).
    const updateChain = mockUpdateChain(null);

    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return merchantChain;
      if (table === 'customers') {
        fromCallCount++;
        return fromCallCount === 1 ? customerChain : updateChain;
      }
      return merchantChain;
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      date_of_birth: '1990-06-15',
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Customer not found');
    expect(json.success).toBeUndefined();
  });

  it('returns 409 without writing when expected_user_id does not match the session', async () => {
    // Regression (is6TybOW): a deferred quiz DOB save must not land on whoever is
    // signed in now. The caller pins the intended shopper via expected_user_id;
    // if the cookie session switched, the gate rejects before any DB access.
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      date_of_birth: '1990-06-15',
      expected_user_id: 'a-different-shopper',
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('session_changed');
    // The identity gate runs before any merchant/customer lookup or write.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
