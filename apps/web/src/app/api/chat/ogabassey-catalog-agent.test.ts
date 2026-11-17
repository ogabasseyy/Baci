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
    mocks.generateText.mockImplementation(async () => {
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
    expect(typeof callOptions?.stopWhen).toBe('function');
    const stopCondition = callOptions?.stopWhen as (ctx: {
      steps: unknown[];
    }) => boolean;
    expect(stopCondition({ steps: [{}] })).toBe(false);
    expect(stopCondition({ steps: [{}, {}, {}] })).toBe(true);
  });

  it('falls back from GPT-6 Luna to Meta Muse Ember on provider failure', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementation(
      async (options: { model: { modelId: string } }) => {
        if (options.model.modelId === 'gpt-6-luna') {
          throw new Error('OpenAI rate limit');
        }
        reportToolResult?.('searchProducts', {
          products: [sampleProduct],
          total: 1,
        });
        return { text: 'Found the Apple MacBook Air M2 in stock.' };
      }
    );

    const result = await runOgabasseyCatalogAgent(baseOptions());

    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls.map(([c]) => c.model.modelId)).toEqual(
      ['gpt-6-luna', 'muse-ember-1.0']
    );
    expect(result?.events[0]?.products[0]?.id).toBe('mac-1');
  });

  it('rejects ungrounded replies when the model skips calling catalog tools', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockResolvedValue({
      text: 'Try the MacBook Air M2 for ₦1,450,000.',
    });

    const result = await runOgabasseyCatalogAgent(baseOptions());

    expect(result).toBeNull();
  });

  it('rejects price or stock claims when search returns no matching products', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementation(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'It costs ₦950,000 and is available now.' };
    });

    const result = await runOgabasseyCatalogAgent(baseOptions());

    expect(result).toBeNull();
  });

  it.each([
    'Hello!',
    'Tell me a joke',
    'What is your WhatsApp number?',
    'What is your last price for iPhone 16?',
    'Cancel my order',
  ])('skips non-catalog or guarded prompts without calling a model: %s', async (content) => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    const result = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content }],
    });

    expect(result).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('returns null when neither OpenAI nor Meta keys are configured', async () => {
    const result = await runOgabasseyCatalogAgent(baseOptions());

    expect(result).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('ignores generic MODEL_API_KEY so non-Meta keys are never routed to Meta', async () => {
    vi.stubEnv('MODEL_API_KEY', 'unrelated-provider-key');

    const result = await runOgabasseyCatalogAgent(baseOptions());

    expect(result).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('accepts grounded price and stock counts matching tool results and rejects fabricated numbers', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 is ₦1,450,000 with 3 in stock.',
      };
    });
    const grounded = await runOgabasseyCatalogAgent(baseOptions());
    expect(grounded?.text).toBe(
      'Apple MacBook Air M2 is ₦1,450,000 with 3 in stock.'
    );

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 is ₦950,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 has 12 units available.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
  });
});
