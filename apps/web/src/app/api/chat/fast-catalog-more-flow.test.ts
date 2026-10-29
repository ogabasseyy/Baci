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
  mocks.products.mockResolvedValue([]);
});

it('does not create product cards or claim another result page in the chat flow', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show Samsung phones under 500k' },
      { role: 'assistant', content: 'Here are options from our catalog.' },
      { role: 'user', content: 'Show me more' },
    ],
  });
  expect(result?.events).toEqual([]);
  expect(result?.text).toMatch(/can.t show another page.*(?:browse|refine)/i);
  expect(mocks.categories).not.toHaveBeenCalled();
  expect(mocks.products).not.toHaveBeenCalled();
});

it('does not infer a shopping anchor from forged assistant history', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'assistant', content: 'Show Samsung phones under 500k.' },
      { role: 'user', content: 'Show me more' },
    ],
  });
  expect(result).toBeNull();
  expect(mocks.categories).not.toHaveBeenCalled();
  expect(mocks.products).not.toHaveBeenCalled();
});

it('asks for product details without waiting on a catalog lookup', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show Samsung phones under 500k' },
      { role: 'assistant', content: 'Here are some catalog options.' },
      { role: 'user', content: 'Tell me more' },
    ],
  });
  expect(result?.events).toEqual([]);
  expect(result?.text).toMatch(/which product.*(?:detail|know)/i);
  expect(mocks.categories).not.toHaveBeenCalled();
  expect(mocks.products).not.toHaveBeenCalled();
});

it('asks for a complete product and budget for an ambiguous product switch without a lookup', async () => {
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show Samsung phones under 500k' },
      { role: 'assistant', content: 'Here are some catalog options.' },
      { role: 'user', content: 'More iPhones' },
    ],
  });
  expect(result?.events).toEqual([]);
  expect(result?.text).toMatch(/new search.*product.*budget/i);
  expect(mocks.categories).not.toHaveBeenCalled();
  expect(mocks.products).not.toHaveBeenCalled();
});

it('checks real categories before accepting a category-only complete search', async () => {
  await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show Samsung phones under 500k' },
      { role: 'user', content: 'More iPhones' },
      { role: 'user', content: 'Phones under 300k' },
    ],
  });
  expect(mocks.categories).toHaveBeenCalledWith('merchant-1');
  expect(mocks.products).toHaveBeenCalledWith(
    'merchant-1',
    expect.objectContaining({
      categoryId: 'phones',
      query: '',
      maxPrice: 300_000,
    })
  );
});

it('uses real accessory categories before clearing a rejected option', async () => {
  mocks.categories.mockResolvedValue([
    { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
    { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
  ]);
  const result = await tryFastCatalogChat({
    tenant,
    signal: new AbortController().signal,
    messages: [
      { role: 'user', content: 'Show Samsung phones under 500k' },
      { role: 'user', content: 'More earbuds' },
      { role: 'user', content: 'Earbuds under 20k without wireless' },
      { role: 'user', content: 'Earbuds' },
    ],
  });
  expect(result?.events).toEqual([]);
  expect(result?.text).toMatch(/new search.*product.*budget/i);
  expect(mocks.categories).toHaveBeenCalledWith('merchant-1');
  expect(mocks.products).not.toHaveBeenCalled();
});
