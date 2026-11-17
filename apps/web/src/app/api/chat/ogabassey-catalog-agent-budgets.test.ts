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

describe('runOgabasseyCatalogAgent budgets', () => {
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

  it('enforces parsed user budget limits on searchProducts parameters and filters over-budget results', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const exactLimitProduct = {
      ...sampleProduct,
      id: 'mac-exact-2m',
      name: 'Apple MacBook Pro M2',
      price: 2_000_000,
      slug: 'apple-macbook-pro-m2',
    };
    const overBudgetProduct = {
      ...sampleProduct,
      id: 'mac-over-budget',
      name: 'Apple MacBook Pro M3 Max',
      price: 2_500_000,
      slug: 'apple-macbook-pro-m3-max',
    };

    const rawSearchExecute = vi.fn(
      async (_params: { query: string; maxPrice?: number }) => {
        const rawPayload = {
          products: [sampleProduct, exactLimitProduct, overBudgetProduct],
          total: 3,
        };
        reportToolResult?.('searchProducts', rawPayload);
        return JSON.stringify(rawPayload);
      }
    );

    mocks.createTools.mockImplementationOnce(
      (
        _sessionId: string,
        options: { onToolResult?: typeof reportToolResult } = {}
      ) => {
        reportToolResult = options.onToolResult;
        return {
          searchProducts: {
            description: 'searchProducts',
            execute: rawSearchExecute,
          },
          getProductDetails: { description: 'getProductDetails' },
        };
      }
    );

    let toolReturnToModel: unknown;
    mocks.generateText.mockImplementationOnce(
      async (options: {
        tools?: {
          searchProducts?: {
            execute?: (params: {
              query: string;
              maxPrice?: number;
            }) => Promise<string>;
          };
        };
      }) => {
        const serialized = await options.tools?.searchProducts?.execute?.({
          query: 'MacBook',
          maxPrice: 3_000_000,
        });
        toolReturnToModel = serialized ? JSON.parse(serialized) : undefined;
        return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
      }
    );

    const exclusiveResult = await runOgabasseyCatalogAgent(baseOptions());
    expect(rawSearchExecute).toHaveBeenCalledWith(
      expect.objectContaining({ maxPrice: 2_000_000, query: 'MacBook' })
    );
    expect(toolReturnToModel).toEqual({
      products: [sampleProduct],
      total: 1,
    });
    expect(exclusiveResult?.events[0]?.products.map((p) => p.id)).toEqual([
      'mac-1',
    ]);

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [exactLimitProduct, overBudgetProduct],
        total: 2,
      });
      return { text: 'Apple MacBook Pro M2 is ₦2,000,000.' };
    });
    const inclusiveResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Show me MacBooks up to 2m' }],
    });
    expect(inclusiveResult?.events[0]?.products.map((p) => p.id)).toEqual([
      'mac-exact-2m',
    ]);
  });

  it('preserves prior conversation budget across over-ear and over there follow-ups', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const overBudgetHeadphone = {
      ...sampleProduct,
      brand: 'Sony',
      category: 'Audio',
      description: 'Sony WH-1000XM5 over-ear headphones',
      id: 'sony-xm5-high',
      name: 'Sony WH-1000XM5 Studio',
      price: 2_300_000,
      slug: 'sony-wh-1000xm5-studio',
    };
    const withinBudgetHeadphone = {
      ...sampleProduct,
      brand: 'Sony',
      category: 'Audio',
      description: 'Sony WH-1000XM4 over-ear headphones',
      id: 'sony-xm4-low',
      name: 'Sony WH-1000XM4',
      price: 450_000,
      slug: 'sony-wh-1000xm4',
    };

    for (const followUp of [
      'Can you check over-ear headphones instead?',
      'Or look over there for another one',
    ]) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', {
          products: [withinBudgetHeadphone, overBudgetHeadphone],
          total: 2,
        });
        return { text: 'Sony WH-1000XM4 is ₦450,000.' };
      });
      const result = await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [
          { role: 'user', content: 'I need headphones below 2m' },
          {
            role: 'assistant',
            content: 'Checking headphones under ₦2,000,000.',
          },
          { role: 'user', content: followUp },
        ],
      });
      expect(result?.events[0]?.products.map((p) => p.id)).toEqual([
        'sony-xm4-low',
      ]);
    }
  });

  it('does not carry prior product budgets into unrelated category searches', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const cameraProduct = {
      ...sampleProduct,
      brand: 'Canon',
      category: 'Cameras',
      description: 'Canon EOS R10 camera',
      id: 'canon-r10',
      name: 'Canon EOS R10',
      price: 850_000,
      slug: 'canon-eos-r10',
    };

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [cameraProduct],
        total: 1,
      });
      return { text: 'Canon EOS R10 is ₦850,000.' };
    });

    const result = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [
        { role: 'user', content: 'Show phones under ₦300k' },
        { role: 'assistant', content: 'Here are phones under ₦300,000.' },
        { role: 'user', content: 'Recommend a camera' },
      ],
    });
    expect(result?.events[0]?.products[0]?.id).toBe('canon-r10');
  });
});
