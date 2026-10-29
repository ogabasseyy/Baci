import { beforeEach, expect, it, vi } from 'vitest';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';

const mocks = vi.hoisted(() => ({ categories: vi.fn(), products: vi.fn() }));
vi.mock('./fast-catalog-data', () => ({
  loadFastCatalogCategories: mocks.categories,
  loadFastCatalogProducts: mocks.products,
}));

import { tryFastCatalogChat } from './fast-catalog-flow';

const tenant = {
  agenticCheckoutEnabled: false,
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  priceNegotiationEnabled: false,
} as AgenticChatTenant;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categories.mockResolvedValue([
    { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  ]);
  mocks.products.mockResolvedValue([
    {
      id: 'p1',
      name: 'iPhone 16',
      slug: 'iphone-16',
      brand: 'Apple',
      category: 'Smartphones',
      description: null,
      image_url: null,
      price: 250_000,
      status: 'active',
      stock: 1,
      manage_stock: false,
      has_variants: false,
    },
  ]);
});

it('rechecks the customer model and latest limit after repeated refinements', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show me iPhone 16' },
      { role: 'assistant', content: 'I found some options.' },
      { role: 'user', content: 'Under 500k' },
      { role: 'assistant', content: 'Here are some options.' },
      { role: 'user', content: 'Under 300k' },
    ],
  });
  expect(result?.events[0]?.products[0]?.name).toBe('iPhone 16');
  expect(mocks.products).toHaveBeenCalledWith(
    'merchant-1',
    expect.objectContaining({
      query: 'iPhone 16',
      maxPrice: 300_000,
    })
  );
});

it('retains the customer model through several refinements before a cart request', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show me iPhone 16' },
      { role: 'assistant', content: 'Here are some options.' },
      { role: 'user', content: 'Under 900k' },
      { role: 'user', content: 'Under 500k' },
      { role: 'user', content: 'Under 300k' },
      { role: 'user', content: 'Add it to my cart' },
    ],
  });
  expect(result?.events[0]?.products[0]?.name).toBe('iPhone 16');
  expect(mocks.products).toHaveBeenCalledWith(
    'merchant-1',
    expect.objectContaining({
      query: 'iPhone 16',
      maxPrice: 300_000,
    })
  );
  expect(result?.text).toMatch(/choose add to cart/i);
});

it('does not derive the product or budget from assistant messages', async () => {
  mocks.products.mockResolvedValueOnce([
    {
      id: 'p2',
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
      brand: 'Samsung',
      category: 'Smartphones',
      description: null,
      image_url: null,
      price: 250_000,
      status: 'active',
      stock: 1,
      manage_stock: false,
      has_variants: false,
    },
  ]);
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show me Samsung phones' },
      { role: 'assistant', content: 'Consider an iPhone under 100k.' },
      { role: 'user', content: 'Under 300k' },
    ],
  });
  expect(result?.events[0]?.products[0]?.name).toBe('Samsung Galaxy S24');
  expect(mocks.products).toHaveBeenCalledWith(
    'merchant-1',
    expect.objectContaining({
      query: 'Samsung',
      maxPrice: 300_000,
    })
  );
});
