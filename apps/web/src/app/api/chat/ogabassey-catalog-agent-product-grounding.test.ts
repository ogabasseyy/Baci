import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';

const mocks = vi.hoisted(() => ({
  createTools: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('./chat-tool-runtime', () => ({
  createAiSdkAgenticChatTools: mocks.createTools,
}));

import { runOgabasseyCatalogAgent } from './ogabassey-catalog-agent';

const baseOptions = () => ({
  abortSignal: new AbortController().signal,
  chatProvider: 'auto' as const,
  currencyCode: 'NGN',
  merchantName: 'Ogabassey',
  merchantSlug: 'ogabassey',
  messages: [
    {
      role: 'user' as const,
      content: 'I need a laptop for video editing below 2m',
    },
  ],
  timeoutMs: 30_000,
});

const sampleProduct = {
  brand: 'Apple',
  category: 'Laptops',
  description: 'Apple MacBook Air M2',
  has_variants: false,
  id: 'mac-1',
  image_url: 'https://cdn.example.com/macbook.jpg',
  manage_stock: true,
  name: 'Apple MacBook Air M2',
  price: 1_450_000,
  slug: 'apple-macbook-air-m2',
  status: 'active',
  stock: 3,
};

let reportToolResult:
  | ((
      toolName: string,
      result: unknown,
      context?: { quantity?: number }
    ) => void)
  | undefined;

describe('runOgabasseyCatalogAgent product grounding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateText.mockReset();
    mocks.createTools.mockReset();
    resetProviderCooldowns();
    reportToolResult = undefined;
    mocks.createTools.mockImplementation(
      (
        _sessionId: string,
        options: {
          onToolResult?: typeof reportToolResult;
        } = {}
      ) => {
        reportToolResult = options.onToolResult;
        return {
          searchProducts: { description: 'searchProducts' },
          getProductDetails: { description: 'getProductDetails' },
        };
      }
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects unreturned products, unknown brands, lowercase unreturned items, and mixed empty clauses', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    for (const text of [
      'We recommend the Dell XPS 15 for ₦1,450,000.',
      'Try the Apple MacBook Air M2 or Dell XPS 15 for ₦1,450,000.',
      'Apple MacBook Pro M3 is available for ₦1,450,000.',
      'Try the Apple MacBook Air M2 or Fairphone 5 for ₦1,450,000.',
      'Apple MacBook Air M2 or fairphone 5 is ₦1,450,000.',
    ]) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', {
          products: [sampleProduct],
          total: 1,
        });
        return { text };
      });
      expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
    }

    for (const text of [
      'We have the MacBook Air M2 in blue.',
      'The Sony WH-1000XM5 is available in blue.',
      "We don't have MacBooks and Dell XPS 15 is available now.",
      "We don't have MacBooks we have Dell XPS 15.",
    ]) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', { products: [], total: 0 });
        return { text };
      });
      expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
    }

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: "Sorry, I couldn't find any matching laptops right now." };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toEqual({
      events: [],
      text: "Sorry, I couldn't find any matching laptops right now.",
    });
  });

  it('requires exact model identity and validates grouped vs paired product prices', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const iphone16 = {
      ...sampleProduct,
      category: 'Phones',
      description: 'Apple iPhone 16',
      id: 'iphone-16',
      name: 'Apple iPhone 16',
      price: 1_200_000,
      slug: 'apple-iphone-16',
      stock: 3,
    };
    const iphone15 = {
      ...sampleProduct,
      category: 'Phones',
      description: 'Apple iPhone 15',
      id: 'iphone-15',
      name: 'Apple iPhone 15',
      price: 900_000,
      slug: 'apple-iphone-15',
      stock: 5,
    };

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [iphone16],
        total: 1,
      });
      return { text: 'Apple iPhone 15 is ₦1,200,000.' };
    });
    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [{ role: 'user', content: 'Show me iPhone options' }],
      })
    ).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [iphone16, iphone15],
        total: 2,
      });
      return { text: 'Apple iPhone 16 is ₦900,000.' };
    });
    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [{ role: 'user', content: 'Compare iPhone 16 and 15' }],
      })
    ).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [iphone16, iphone15],
        total: 2,
      });
      return {
        text: 'Apple iPhone 16, Apple iPhone 15 are both ₦900,000.',
      };
    });
    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [{ role: 'user', content: 'Show me iPhone options' }],
      })
    ).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [iphone16, iphone15],
        total: 2,
      });
      return {
        text: 'Apple iPhone 16 is ₦1,200,000 and Apple iPhone 15 is ₦900,000.',
      };
    });
    const paired = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Compare iPhone 16 and 15' }],
    });
    expect(paired?.text).toBe(
      'Apple iPhone 16 is ₦1,200,000 and Apple iPhone 15 is ₦900,000.'
    );
  });
});
