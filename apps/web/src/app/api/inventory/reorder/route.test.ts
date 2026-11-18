import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

const mockGetMerchantForApiRequest = vi.fn(() =>
  Promise.resolve({
    merchantId: 'merchant-123',
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: {},
  })
);

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...(args as [])),
  toUserAccess: vi.fn((ctx: Record<string, unknown>) => ({
    merchantId: ctx.merchantId ?? 'merchant-123',
    role: ctx.role ?? 'owner',
    isOwner: ctx.isOwner ?? false,
    isStaff: ctx.isStaff ?? false,
    permissions: ctx.permissions ?? {},
  })),
}));

// Mock Supabase Query Builder to be "Thenable" without triggering 'noThenProperty'
// We define a class or object that implements the interface.
// Biome rule documentation says: "Do not add then to an object."
// We can use a Promise mock or just suppress the lint since it IS a thenable mock.
// Given it's a test file, suppression is acceptable if refactoring is complex.
// However, let's try to do it cleanly by casting to Promise-like.

const queryBuilder = {
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null }),
  // biome-ignore lint/suspicious/noThenProperty: Mocking a Thenable interface for Supabase
  then: (resolve: any) => resolve({ data: [], error: null }),
};

const mockFrom = vi.fn(() => queryBuilder);

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({
          data: { user: { id: 'user-123' } },
          error: null,
        })
      ),
    },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

// Import handler AFTER mocks
import { GET, POST } from './route';

describe('/api/inventory/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('uses explicit column selection', async () => {
      const url = new URL('http://localhost:3000/api/inventory/reorder');
      const req = new NextRequest(url.toString(), { method: 'GET' });

      await GET(req);

      expect(queryBuilder.select).toHaveBeenCalled();
      const selectArgs = queryBuilder.select.mock.calls[0][0];

      // Verification: Should NOT contain top-level '*'
      // The current implementation has `*` so this assertion will FAIL initially.
      // We assert the DESIRED state.
      expect(selectArgs).not.toMatch(/^\*,/); // Should not start with '*, '
      expect(selectArgs).not.toMatch(/^\*\s*,/);
      expect(selectArgs).toContain('id');
      expect(selectArgs).toContain('suggested_quantity');
    });

    it('returns 403 when caller lacks products:view permission', async () => {
      mockGetMerchantForApiRequest.mockResolvedValueOnce({
        merchantId: 'merchant-123',
        role: 'staff',
        isOwner: false,
        isStaff: true,
        permissions: { products: { view: false } },
      });

      const req = new NextRequest(
        'http://localhost:3000/api/inventory/reorder',
        { method: 'GET' }
      );
      const res = await GET(req);

      expect(res.status).toBe(403);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    it('rejects invalid action', async () => {
      const body = {
        suggestionId: '123e4567-e89b-12d3-a456-426614174000',
        action: 'invalid_action',
      };
      const req = new NextRequest(
        'http://localhost:3000/api/inventory/reorder',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBeDefined();
    });

    it('rejects missing orderedQuantity when action is ordered', async () => {
      const body = {
        suggestionId: '123e4567-e89b-12d3-a456-426614174000',
        action: 'ordered',
        // missing orderedQuantity
      };
      const req = new NextRequest(
        'http://localhost:3000/api/inventory/reorder',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      const res = await POST(req);
      const _json = await res.json();
      expect(res.status).toBe(400);
    });

    it('rejects negative orderedQuantity', async () => {
      const body = {
        suggestionId: '123e4567-e89b-12d3-a456-426614174000',
        action: 'ordered',
        orderedQuantity: -5,
      };
      const req = new NextRequest(
        'http://localhost:3000/api/inventory/reorder',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('accepts valid input', async () => {
      const body = {
        suggestionId: '123e4567-e89b-12d3-a456-426614174000',
        action: 'accept',
      };
      const req = new NextRequest(
        'http://localhost:3000/api/inventory/reorder',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      expect(queryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'accepted',
        })
      );
    });
  });
});
