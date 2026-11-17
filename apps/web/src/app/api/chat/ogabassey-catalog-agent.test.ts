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

describe('runOgabasseyCatalogAgent', () => {
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
          getRecommendations: { description: 'getRecommendations' },
          addToCart: { description: 'addToCart' },
          createVirtualAccount: { description: 'createVirtualAccount' },
          cancelOrder: { description: 'cancelOrder' },
          checkPaymentStatus: { description: 'checkPaymentStatus' },
        };
      }
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses Meta Muse Ember with read-only search tools and multi-step stopWhen when META_MODEL_API_KEY is set', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'We have the Apple MacBook Air M2 available under your ₦2,000,000 budget.',
      };
    });

    const result = await runOgabasseyCatalogAgent(baseOptions());
    expect(result).toEqual({
      events: [
        expect.objectContaining({
          intent: 'discover',
          products: [
            expect.objectContaining({
              id: 'mac-1',
              name: 'Apple MacBook Air M2',
            }),
          ],
          type: 'present_products',
        }),
      ],
      text: 'We have the Apple MacBook Air M2 available under your ₦2,000,000 budget.',
    });

    const callOptions = mocks.generateText.mock.calls[0]?.[0];
    expect(callOptions?.model).toMatchObject({
      modelId: 'muse-ember-1.0',
      provider: 'meta.chat',
    });
    expect(Object.keys(callOptions?.tools ?? {})).toEqual([
      'searchProducts',
      'getProductDetails',
    ]);
    const stopCondition = callOptions?.stopWhen as (ctx: {
      steps: unknown[];
    }) => boolean;
    expect(stopCondition({ steps: [{}, {}, {}, {}] })).toBe(false);
    expect(stopCondition({ steps: [{}, {}, {}, {}, {}] })).toBe(true);
  });

  it('falls back across OpenAI, Meta, and DeepSeek and honors key configuration boundaries', async () => {
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    vi.stubEnv('MODEL_API_KEY', 'unrelated-provider-key');
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementationOnce(async () => {
      throw new Error('OpenAI rate limit');
    });
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return { text: 'Found the Apple MacBook Air M2 in stock.' };
    });
    const metaFallbackResult = await runOgabasseyCatalogAgent(baseOptions());
    expect(metaFallbackResult?.events[0]?.products[0]?.id).toBe('mac-1');
    expect(
      mocks.generateText.mock.calls.slice(-2).map(([c]) => c.model.modelId)
    ).toEqual(['gpt-6-luna', 'muse-ember-1.0']);

    vi.unstubAllEnvs();
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key');
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
    });
    const deepseekResult = await runOgabasseyCatalogAgent(baseOptions());
    expect(deepseekResult?.text).toBe('Apple MacBook Air M2 is ₦1,450,000.');
    expect(mocks.generateText.mock.calls.at(-1)?.[0]?.model).toMatchObject({
      modelId: 'deepseek-flash',
    });
  });

  it('reserves fallback budget across all three configured providers', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key');
    mocks.generateText.mockImplementation(
      async (options: { model: { modelId: string } }) => {
        if (options.model.modelId !== 'deepseek-flash') {
          throw new Error(`${options.model.modelId} timed out`);
        }
        reportToolResult?.('searchProducts', {
          products: [sampleProduct],
          total: 1,
        });
        return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
      }
    );
    const threeProviderResult = await runOgabasseyCatalogAgent(baseOptions());
    expect(threeProviderResult?.text).toBe(
      'Apple MacBook Air M2 is ₦1,450,000.'
    );
    expect(
      mocks.generateText.mock.calls.slice(-3).map(([c]) => c.model.modelId)
    ).toEqual(['gpt-6-luna', 'muse-ember-1.0', 'deepseek-flash']);
  });

  it('ignores late tool callbacks from failed provider attempts and requires searchProducts for empty replies', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    let staleAttemptCallback: typeof reportToolResult;
    mocks.generateText.mockImplementationOnce(async () => {
      staleAttemptCallback = reportToolResult;
      throw new Error('OpenAI attempt timed out');
    });
    mocks.generateText.mockImplementationOnce(async () => {
      staleAttemptCallback?.('searchProducts', { products: [], total: 0 });
      return { text: "Sorry, I couldn't find any laptops." };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    vi.unstubAllEnvs();
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('getProductDetails', {
        available: false,
      });
      return { text: "Sorry, I couldn't find any laptops." };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Rejects empty-result reply when searchProducts searched an unrelated product
    mocks.createTools.mockImplementationOnce(
      (
        _sessionId: string,
        options: { onToolResult?: typeof reportToolResult } = {}
      ) => {
        reportToolResult = options.onToolResult;
        return {
          searchProducts: {
            description: 'searchProducts',
            execute: async () => {
              const empty = { products: [], total: 0 };
              reportToolResult?.('searchProducts', empty);
              return JSON.stringify(empty);
            },
          },
          getProductDetails: { description: 'getProductDetails' },
        };
      }
    );
    mocks.generateText.mockImplementationOnce(
      async (options: {
        tools?: {
          searchProducts?: {
            execute?: (params: { query: string }) => Promise<string>;
          };
        };
      }) => {
        await options.tools?.searchProducts?.execute?.({ query: 'iPhone' });
        return { text: "Sorry, I couldn't find Fairphone 5 in our catalog." };
      }
    );
    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [{ role: 'user', content: 'Do you carry Fairphone 5?' }],
      })
    ).toBeNull();
  });
});
