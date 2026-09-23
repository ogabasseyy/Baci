import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateApiRequest = vi.fn();
const getUserAccess = vi.fn();
const hasPermission = vi.fn();
const checkCsrfProtection = vi.fn();
const createAdminClient = vi.fn();
const validOrderId = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: vi.fn(),
}));

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
      supabase: { rpc: vi.fn() },
    });
    checkCsrfProtection.mockResolvedValue({ valid: true });
    getUserAccess.mockResolvedValue({ isOwner: true, merchantId: 'm1' });
    hasPermission.mockReturnValue(true);
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

  it('returns 403 for non-owner or missing fulfill permission', async () => {
    getUserAccess.mockResolvedValue({ isOwner: false, merchantId: 'm1' });
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 403 when fulfillment permission is absent', async () => {
    hasPermission.mockReturnValue(false);
    const { postAdminOrderGiglQuote } = await import(
      './admin-order-gigl-quote'
    );
    const response = await postAdminOrderGiglQuote(
      request({ admin_order_id: validOrderId })
    );
    expect(response.status).toBe(403);
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
