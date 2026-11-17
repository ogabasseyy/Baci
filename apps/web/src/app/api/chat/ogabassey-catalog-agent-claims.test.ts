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

describe('runOgabasseyCatalogAgent claim guards', () => {
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

  it('fails closed on malformed budget JSON returned by catalog tools', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.createTools.mockImplementationOnce(
      (
        _sessionId: string,
        options: { onToolResult?: typeof reportToolResult } = {}
      ) => {
        reportToolResult = options.onToolResult;
        return {
          searchProducts: {
            description: 'searchProducts',
            execute: async () => 'not-valid-json',
          },
          getProductDetails: {
            description: 'getProductDetails',
            execute: async () => 'not-valid-json',
          },
        };
      }
    );

    let searchSerialized: unknown;
    let detailsSerialized: unknown;
    mocks.generateText.mockImplementationOnce(
      async (options: {
        tools?: {
          searchProducts?: {
            execute?: (params: { query: string }) => Promise<string>;
          };
          getProductDetails?: {
            execute?: (params: { productId: string }) => Promise<string>;
          };
        };
      }) => {
        searchSerialized = JSON.parse(
          (await options.tools?.searchProducts?.execute?.({
            query: 'MacBook',
          })) ?? '{}'
        );
        detailsSerialized = JSON.parse(
          (await options.tools?.getProductDetails?.execute?.({
            productId: 'mac-1',
          })) ?? '{}'
        );
        reportToolResult?.('searchProducts', { products: [], total: 0 });
        return { text: "Sorry, I couldn't verify any products under budget." };
      }
    );

    await runOgabasseyCatalogAgent(baseOptions());
    expect(searchSerialized).toEqual({ products: [], total: 0 });
    expect(detailsSerialized).toEqual({ available: false });
  });

  it('rejects fabricated cart/order actions and ungrounded hardware specs or warranties', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    for (const actionClaim of [
      "I've added the Apple MacBook Air M2 to your cart.",
      'I ordered the Apple MacBook Air M2 for you.',
      'Apple MacBook Air M2 has 64 GB RAM and a two-year warranty for ₦1,450,000.',
      'Apple MacBook Air M2 is 20% off today.',
    ]) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', {
          products: [sampleProduct],
          total: 1,
        });
        return { text: actionClaim };
      });
      expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
    }
  });

  it('rejects grouped stock assertions when any named product violates the claimed stock state', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const outOfStockPhone = {
      ...sampleProduct,
      category: 'Phones',
      id: 'iphone-oos',
      name: 'Apple iPhone 16',
      price: 1_200_000,
      slug: 'apple-iphone-16',
      stock: 0,
    };
    const inStockPhone = {
      ...sampleProduct,
      category: 'Phones',
      id: 'iphone-in',
      name: 'Apple iPhone 15',
      price: 900_000,
      slug: 'apple-iphone-15',
      stock: 4,
    };

    for (const claim of [
      'Apple iPhone 16, Apple iPhone 15 are in stock.',
      'Apple iPhone 16, Apple iPhone 15 are out of stock.',
    ]) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', {
          products: [outOfStockPhone, inStockPhone],
          total: 2,
        });
        return { text: claim };
      });
      expect(
        await runOgabasseyCatalogAgent({
          ...baseOptions(),
          messages: [{ role: 'user', content: 'Show me iPhone options' }],
        })
      ).toBeNull();
    }
  });
});
