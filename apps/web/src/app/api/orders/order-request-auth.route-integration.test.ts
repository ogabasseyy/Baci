import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { resolveSharedCartOrderAuthority } from '@/lib/cart/order-route-binding';
import { POST } from './route';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  hasPermission: vi.fn(() => true),
}));

vi.mock('@/lib/geo-privacy', () => ({
  detectPrivacyRegion: vi.fn().mockResolvedValue({ shouldApplyLDU: false }),
}));

vi.mock('@/lib/cart/order-route-binding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cart/order-route-binding')>()),
  resolveSharedCartOrderAuthority: vi.fn(),
}));

describe('UBA checkout recovery authentication', () => {
  it('stops before order processing when the shopper session cannot be verified', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValueOnce({
      user: null,
      error: 'Authentication failed',
      supabase: null,
    });
    const request = new NextRequest('https://store.example/api/orders', {
      method: 'POST',
      headers: { 'x-checkout-recovery': '1' },
      body: '{}',
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(authenticateApiRequest).toHaveBeenCalledWith(request, {
      requireVerifiedGuest: true,
    });
  });

  it('passes the verified user and recovery requirement into the cart authority check', async () => {
    const userId = '55555555-5555-4555-8555-555555555555';
    const merchantId = '11111111-1111-4111-8111-111111111111';
    const binding = {
      cart_id: '22222222-2222-4222-8222-222222222222',
      cart_version: 1,
      checkout_generation: 1,
      checkout_session_id: '44444444-4444-4444-8444-444444444444',
    };
    vi.mocked(authenticateApiRequest).mockResolvedValueOnce({
      user: { id: userId } as never,
      error: null,
      supabase: {} as never,
    });
    vi.mocked(resolveSharedCartOrderAuthority).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Denied' }, { status: 401 }),
    });
    const request = new NextRequest('https://store.example/api/orders', {
      method: 'POST',
      headers: { 'x-checkout-recovery': '1' },
      body: JSON.stringify({
        merchant_id: merchantId,
        customer_email: 'shopper@example.test',
        customer_name: 'Test Shopper',
        items: [
          { product_id: 'product', name: 'Test', quantity: 1, price: 100 },
        ],
        subtotal: 100,
        payment_method: 'uba_redvault',
        shared_cart: binding,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(resolveSharedCartOrderAuthority).toHaveBeenCalledWith(
      request,
      binding,
      merchantId,
      expect.any(Function),
      { userId, paymentMethod: 'uba_redvault', requireRecoveryProof: true }
    );
  });
});
