import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAutoReplyProduct } from '@/ai/chat-auto-reply';

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  readSnapshot: vi.fn(),
  projectCard: vi.fn(),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));
vi.mock('@/lib/storefront-pdp-core-snapshot', () => ({
  readStorefrontPdpCoreSnapshot: mocks.readSnapshot,
}));
vi.mock('./product-card-projection', () => ({
  projectChatwootProductCard: mocks.projectCard,
}));

import { prepareChatwootProductCards } from './prepare-product-cards';

const baseCard: ChatAutoReplyProduct = {
  name: 'iPhone 13',
  slug: 'iphone-13',
  currency: 'NGN',
};

describe('prepareChatwootProductCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPublicClient.mockReturnValue({ tag: 'public-client' });
  });

  it('attaches initialProduct and imageUrl when snapshot and projection succeed', async () => {
    const projectedProduct = {
      name: 'iPhone 13',
      slug: 'iphone-13',
      currency: 'NGN',
      availability: 'in_stock' as const,
      price: 385000,
      image: 'https://cdn.example.test/iphone-13.avif',
      variants: [],
    };
    mocks.readSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: { kind: 'product', product: { id: 'p-1' } },
    });
    mocks.projectCard.mockReturnValueOnce({
      ok: true,
      product: projectedProduct,
    });

    const [prepared] = await prepareChatwootProductCards('merchant-1', [
      baseCard,
    ]);
    expect(prepared).toEqual({
      ...baseCard,
      imageUrl: 'https://cdn.example.test/iphone-13.avif',
      initialProduct: projectedProduct,
    });
  });

  it('skips storefrontOnly or missing-currency cards without querying snapshots', async () => {
    const cards: ChatAutoReplyProduct[] = [
      { ...baseCard, storefrontOnly: true },
      { name: 'Mystery', slug: 'mystery' },
    ];
    const result = await prepareChatwootProductCards('merchant-1', cards);
    expect(result).toEqual(cards);
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
  });

  it('falls back to the original card on missing, non-product, or rejected snapshots', async () => {
    mocks.readSnapshot
      .mockResolvedValueOnce({ status: 'not_found' })
      .mockResolvedValueOnce({
        status: 'found',
        value: { kind: 'redirect', to: '/other' },
      })
      .mockResolvedValueOnce({
        status: 'found',
        value: { kind: 'product', product: { id: 'p-3' } },
      });
    mocks.projectCard.mockReturnValueOnce({ ok: false, reason: 'mismatch' });

    const cards = [
      { ...baseCard, slug: 'missing' },
      { ...baseCard, slug: 'redirect' },
      { ...baseCard, slug: 'rejected' },
    ];
    expect(await prepareChatwootProductCards('merchant-1', cards)).toEqual(
      cards
    );
  });

  it('falls back cleanly when snapshot reads throw or public client creation fails', async () => {
    mocks.readSnapshot.mockRejectedValueOnce(new Error('timeout'));
    expect(await prepareChatwootProductCards('merchant-1', [baseCard])).toEqual(
      [baseCard]
    );

    mocks.createPublicClient.mockImplementationOnce(() => {
      throw new Error('config missing');
    });
    expect(await prepareChatwootProductCards('merchant-1', [baseCard])).toEqual(
      [baseCard]
    );
  });

  it('omits initialProduct when the serialized snapshot exceeds the 24 KB cutoff', async () => {
    const hugeProduct = {
      name: 'iPhone 13',
      slug: 'iphone-13',
      currency: 'NGN',
      availability: 'in_stock' as const,
      price: 385000,
      image: 'https://cdn.example.test/iphone-13.avif',
      variants: [{ sku: 'A'.repeat(25_000) }],
    };
    mocks.readSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: { kind: 'product', product: { id: 'p-1' } },
    });
    mocks.projectCard.mockReturnValueOnce({
      ok: true,
      product: hugeProduct,
    });

    const [prepared] = await prepareChatwootProductCards('merchant-1', [
      baseCard,
    ]);
    expect(prepared).toEqual({
      ...baseCard,
      imageUrl: 'https://cdn.example.test/iphone-13.avif',
    });
    expect(prepared).not.toHaveProperty('initialProduct');
  });
});
