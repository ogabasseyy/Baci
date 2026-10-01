/** @vitest-environment node */
import { renderToReadableStream } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CartPage from './page';

const mocks = vi.hoisted(() => ({
  merchant: vi.fn(),
  domain: vi.fn(),
  single: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: mocks.merchant,
  getCachedMerchantByDomain: mocks.domain,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
vi.mock('@/app/(storefront)/[slug]/storefront-loading-ui', () => ({
  CommerceRouteLoading: () => <p>Loading cart</p>,
}));
vi.mock('@/components/storefront/ogabassey/pages/cart-page-wrapper', () => ({
  CartPageWrapper: ({ vatRate }: { vatRate: number }) => (
    <p>Cart VAT {vatRate}</p>
  ),
}));

describe('cart route streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockResolvedValue({ id: 'merchant-1' });
    mocks.domain.mockResolvedValue({ id: 'merchant-1' });
  });

  it('streams a loading boundary while the live VAT query is pending', async () => {
    const vat = Promise.withResolvers<{
      data: { vat_registration_status: string; vat_rate: number };
      error: null;
    }>();
    mocks.single.mockReturnValue(vat.promise);
    const page = await CartPage({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });
    const stream = await renderToReadableStream(<main>{page}</main>, {
      bootstrapScripts: ['/test-client.js'],
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('Loading cart');
    vat.resolve({
      data: { vat_registration_status: 'registered', vat_rate: 7.5 },
      error: null,
    });
    let remaining = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      remaining += new TextDecoder().decode(next.value);
    }
    expect(remaining).toContain('Cart VAT');
    expect(remaining).toContain('7.5');
  });

  it('rejects a missing merchant before fetching VAT settings', async () => {
    mocks.merchant.mockResolvedValue(null);
    await expect(
      CartPage({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('not found');
    expect(mocks.single).not.toHaveBeenCalled();
  });
});
