import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tryFastCatalogChat: vi.fn() }));
vi.mock('./fast-catalog-flow', () => ({
  tryFastCatalogChat: mocks.tryFastCatalogChat,
}));

import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import { tryFastCatalogResponse } from './fast-catalog-response';

const tenant = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  agenticCheckoutEnabled: true,
  priceNegotiationEnabled: true,
};
const messages = [{ role: 'user' as const, content: 'Show me phones' }];
const products = [
  {
    id: 'p1',
    name: 'iPhone 16',
    slug: 'iphone-16',
    category: 'Smartphones',
    price: 200000,
    hasVariants: false,
    manageStock: false,
  },
  {
    id: 'p2',
    name: 'iPhone 16 Pro',
    slug: 'iphone-16-pro',
    category: 'Smartphones',
    price: 300000,
    hasVariants: true,
    manageStock: false,
  },
].map((product) => ({
  ...product,
  brand: null,
  description: null,
  imageUrl: null,
  stock: 1,
}));
const reply = {
  text: 'Here are options from our catalog.',
  events: [
    {
      type: 'present_products' as const,
      intent: 'discover' as const,
      title: 'Products',
      products,
    },
  ],
};

describe('tryFastCatalogResponse', () => {
  it('gives text-only clients actionable links and only verified fixed prices', async () => {
    mocks.tryFastCatalogChat.mockResolvedValue(reply);
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat', {
        headers: { accept: 'text/plain' },
      }),
      messages,
      tenant,
      'auto'
    );
    const text = await response?.text();
    expect(text).toContain('https://ogabassey.com/smartphones/iphone-16');
    expect(text).toContain('https://ogabassey.com/smartphones/iphone-16-pro');
    expect(text).toContain('₦200,000');
    expect(text).not.toContain('₦300,000');
    expect(text).toMatch(/open.*link/i);
  });

  it('keeps the agent UI payload unchanged for the web widget', async () => {
    mocks.tryFastCatalogChat.mockResolvedValue(reply);
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat', {
        headers: { accept: storefrontAgentUiContract.mediaType },
      }),
      messages,
      tenant,
      'auto'
    );
    const data = await response?.json();
    expect(data.text).toBe(reply.text);
    expect(data.events[0].products).toHaveLength(2);
  });

  it('marks a catalog outage so health checks can detect it', async () => {
    mocks.tryFastCatalogChat.mockResolvedValue({
      text: 'Catalog unavailable',
      events: [],
      unavailable: true,
    });
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat'),
      messages,
      tenant,
      'auto'
    );
    expect(response?.headers.get('x-baci-chat-fallback')).toBe(
      'catalog_unavailable'
    );
  });

  it('marks an actual catalog lookup in the response headers', async () => {
    mocks.tryFastCatalogChat.mockResolvedValue({
      text: 'No matches',
      events: [],
      catalogChecked: true,
    });
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat'),
      messages,
      tenant,
      'auto'
    );
    expect(response?.headers.get('x-baci-chat-catalog')).toBe('checked');
  });
});
