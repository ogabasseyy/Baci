import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

it('starts merchant-scoped offer lookup while the independent variant query waits', async () => {
  const product = '11111111-1111-4111-8111-111111111111';
  const merchant = '77777777-7777-4777-8777-777777777777';
  const variant = '33333333-3333-4333-8333-333333333333';
  const offer = '55555555-5555-4555-8555-555555555555';
  let releaseVariants = () => {};
  const variants = new Promise<{ data: never[]; error: null }>((resolve) => {
    releaseVariants = () => resolve({ data: [], error: null });
  });
  let signalOffer: (merchantId: string) => void = () => {};
  const offerStarted = new Promise<string>((resolve) => {
    signalOffer = resolve;
  });
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    returns: vi.fn().mockResolvedValue({
      data: [
        {
          id: product,
          merchant_id: merchant,
          name: 'Test',
          price: 100,
          status: 'active',
        },
      ],
      error: null,
    }),
  };
  mocks.createClient.mockResolvedValue({
    from: vi.fn(() => query),
    rpc: vi.fn((name: string, args: { p_merchant_id?: string }) => {
      if (name === 'get_storefront_offer_resolution') {
        signalOffer(args.p_merchant_id ?? 'missing');
        return Promise.resolve({ data: [], error: null });
      }
      return { range: vi.fn(() => variants) };
    }),
  });
  const response = POST(
    new NextRequest('https://example.com/api/cart/validate', {
      method: 'POST',
      body: JSON.stringify({
        cartItems: [
          { id: product, price: 100, variantId: variant },
          { id: product, price: 100, offerId: offer },
        ],
      }),
    })
  );
  try {
    const started = await offerStarted;
    expect(started).toBe(merchant);
  } finally {
    releaseVariants();
    await response;
  }
});
