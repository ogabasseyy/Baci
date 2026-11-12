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
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: matched, error: null });
  return { update: vi.fn().mockReturnValue(chain) };
}

// --- Tests ---

describe('PATCH /api/storefront/customer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a valid CSRF token. Individual tests override to exercise the
    // rejection path.
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 403 when the CSRF token is missing or invalid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: false });

    const request = makeRequest({
      merchantSlug: 'test-store',
      date_of_birth: '1990-06-15',
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('Invalid CSRF token');
    // The write must never happen when CSRF validation fails.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    });

    const request = makeRequest({ merchantSlug: 'test-store' });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const request = makeRequest({ first_name: 'John' });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
    expect(json.details).toBeDefined();
  });

  it('returns 400 when saved_addresses has invalid structure', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      saved_addresses: [{ label: 'Home' }], // missing required fields
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
  });

  it('returns 200 on valid PATCH with optional fields', async () => {
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
        // First call: select customer, second call: update customer
        return fromCallCount === 1 ? customerChain : updateChain;
      }
      return merchantChain;
    });

    const request = makeRequest({
      merchantSlug: 'test-store',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+234800000000',
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      message: 'Profile updated successfully',
    });

    // Verify DB update was called with correct payload
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'John',
        last_name: 'Doe',
        phone: '+234800000000',
      })
    );
  });

  it('returns 200 on valid PATCH with saved_addresses', async () => {
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

    const validAddress = {
      id: 'addr-1',
      label: 'Home',
      full_name: 'John Doe',
      phone: '+234800000000',
      address: '123 Main St',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postal_code: '100001',
      is_default: true,
    };

    const request = makeRequest({
      merchantSlug: 'test-store',
      saved_addresses: [validAddress],
    });
    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      message: 'Profile updated successfully',
    });

    // Verify DB update was called with saved_addresses
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        saved_addresses: [validAddress],
      })
    );
  });

  it('[data integrity fix] rejects update if merchant or user ID is mismatched during read-modify-write', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const merchantChain = mockChain({
      data: { id: 'merchant-1' },
      error: null,
    });
    // The customer lookup succeeds
    const customerChain = mockChain({
      data: { id: 'customer-1' },
      error: null,
    });
    // But the concurrent/race mutation update fails to match the row (returns null)
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
      first_name: 'John',
    });
    const response = await PATCH(request);
    const json = await response.json();

    // The endpoint should fail safely if the scoped update hits zero rows
    expect(response.status).toBe(404);
    expect(json.error).toBe('Customer not found');
  });

  it('returns 400 on malformed JSON body', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const request = new Request('http://localhost/api/storefront/customer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    }) as unknown as NextRequest;

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Invalid JSON');
  });
});
