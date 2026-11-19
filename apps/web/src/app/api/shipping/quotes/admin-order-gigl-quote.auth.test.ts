import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';

const authenticateApiRequest = vi.fn();
const getUserAccess = vi.fn();
const checkCsrfProtection = vi.fn();
const createAdminClient = vi.fn();
const merchantLookup = vi.fn();
const validOrderId = '11111111-1111-4111-8111-111111111111';

// Real permission evaluation: owners pass, staff need orders.fulfill.
vi.mock('@/lib/api-auth', async () => {
  const permissions = await vi.importActual<
    typeof import('@/lib/api-permissions')
  >('@/lib/api-permissions');
  return {
    authenticateApiRequest,
    getUserAccess,
    hasPermission: permissions.hasPermission,
  };
});
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: vi.fn(),
}));

function staff(permissions: UserAccess['permissions']): UserAccess {
  return {
    merchantId: 'm1',
    role: 'fulfillment',
    isOwner: false,
    isStaff: true,
    permissions,
  };
}

// Past the gate the route reads merchant eligibility; a failing read is the
// observable proof the caller was admitted without running the full flow.
function eligibilityProbe() {
  return {
    rpc: vi.fn(),
    from: vi.fn((table: string) => {
      merchantLookup(table);
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'probe' } }),
      };
    }),
  };
}

function request(body: unknown = {}) {
  return new NextRequest('https://usebaci.com/api/shipping/quotes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-baci-admin-order-mode': '1',
    },
    body: JSON.stringify(body),
  });
}

describe('Admin GIGL quote edge authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase: eligibilityProbe(),
    });
    checkCsrfProtection.mockResolvedValue({ valid: true });
    getUserAccess.mockResolvedValue({
      merchantId: 'm1',
      role: 'owner',
      isOwner: true,
      isStaff: false,
      permissions: {},
    } satisfies UserAccess);
    createAdminClient.mockImplementation(() => {
      throw new Error('must not create admin client in this test');
    });
  });

  it('returns 401 before reading malformed input', async () => {
    authenticateApiRequest.mockResolvedValue({ user: null, supabase: null });
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: 'bad' })
    );
    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 403 before creating a privileged client when CSRF fails', async () => {
    checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: new Response('csrf', { status: 403 }),
    });
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(403);
    expect(getUserAccess).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('admits the owner past the access gate', async () => {
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(500);
    expect(merchantLookup).toHaveBeenCalledWith('merchants');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('admits staff granted only orders.fulfill to the price preview', async () => {
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, fulfill: true } })
    );
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId, preview: true })
    );
    expect(response.status).not.toBe(403);
    expect(merchantLookup).toHaveBeenCalledWith('merchants');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('admits staff granted orders.fulfill and orders.edit to binding', async () => {
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, fulfill: true, edit: true } })
    );
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).not.toBe(403);
    expect(merchantLookup).toHaveBeenCalledWith('merchants');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a bind from orders.fulfill staff without orders.edit before any read', async () => {
    // Binding rewrites the order and leads to a booking that needs
    // orders.edit; a fulfil-only bind could never be booked.
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, fulfill: true } })
    );
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(403);
    expect(merchantLookup).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ['orders.edit only', { orders: { view: true, edit: true } }, false],
    [
      'orders.edit only (preview)',
      { orders: { view: true, edit: true } },
      true,
    ],
    ['explicit fulfill denial', { orders: { fulfill: false } }, true],
    ['no orders grant', { products: { view: true } }, true],
  ])('returns 403 for staff with %s', async (_label, grants, preview) => {
    getUserAccess.mockResolvedValue(staff(grants));
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId, ...(preview ? { preview } : {}) })
    );
    expect(response.status).toBe(403);
    expect(merchantLookup).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('validates Admin input before checking merchant access', async () => {
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: 'bad' })
    );
    expect(response.status).toBe(400);
    expect(getUserAccess).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects missing merchant access before privileged client creation', async () => {
    getUserAccess.mockResolvedValue(null);
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
