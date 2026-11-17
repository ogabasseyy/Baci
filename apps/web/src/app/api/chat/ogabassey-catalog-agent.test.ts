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
    expect(stopCondition({ steps: [{}, {}, {}, {}] })).toBe(false);
    expect(stopCondition({ steps: [{}, {}, {}, {}, {}] })).toBe(true);
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
    'Tips for photo editing',
    'Why is my number 2 failing?',
    'Can you recommend a restaurant?',
    'Are you available to help?',
    'What is the cost of living?',
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

  it('rejects budget-echo prices, model-number prices, and bare unformatted prices', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    // Budget-echo presented as product price (tool returned 1,450,000, not 2,000,000)
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'The Apple MacBook Air M2 is ₦2,000,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Model number fragment ("iPhone 16") must not allow "₦16"
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'This iPhone 16 option is ₦16.',
      };
    });
    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [{ role: 'user', content: 'Show me iPhone 16 options' }],
      })
    ).toBeNull();

    // Bare-digit hallucinated price (no currency symbol or commas)
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 costs 950000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Legitimate release year and display spec are not treated as prices
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 (2025) with 1080p webcam is ₦1,450,000.',
      };
    });
    const withSpec = await runOgabasseyCatalogAgent(baseOptions());
    expect(withSpec?.text).toBe(
      'Apple MacBook Air M2 (2025) with 1080p webcam is ₦1,450,000.'
    );
  });

  it('rejects unreturned or fabricated product names and positive empty-result claims', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    // Fabricated product name even with matching returned price
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'We recommend the Dell XPS 15 for ₦1,450,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Mixed real + fabricated product recommendation
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Try the Apple MacBook Air M2 or Dell XPS 15 for ₦1,450,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Wrong tier/chip variant alongside returned family
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Pro M3 is available for ₦1,450,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Empty-result positive attribute/availability hallucinations without currency
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'We have the MacBook Air M2 in blue.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'The Sony WH-1000XM5 is available in blue.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    // Honest negative empty-result response still succeeds with empty events
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: "Sorry, I couldn't find any matching laptops right now." };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toEqual({
      events: [],
      text: "Sorry, I couldn't find any matching laptops right now.",
    });
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
        return {
          text: 'Apple MacBook Air M2 is ₦1,450,000.',
        };
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

    // Inclusive budget ("up to 2m") allows an item priced at exactly 2,000,000
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [exactLimitProduct, overBudgetProduct],
        total: 2,
      });
      return {
        text: 'Apple MacBook Pro M2 is ₦2,000,000.',
      };
    });
    const inclusiveResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Show me MacBooks up to 2m' }],
    });
    expect(inclusiveResult?.events[0]?.products.map((p) => p.id)).toEqual([
      'mac-exact-2m',
    ]);
  });

  it('triggers fallback for pixel, bare galaxy, and gaming cues and generates per-request session ids', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const pixelProduct = {
      ...sampleProduct,
      brand: 'Google',
      category: 'Phones',
      description: 'Google Pixel 9 Pro',
      id: 'pixel-9',
      name: 'Google Pixel 9',
      slug: 'google-pixel-9',
    };
    const galaxyProduct = {
      ...sampleProduct,
      brand: 'Samsung',
      category: 'Phones',
      description: 'Samsung Galaxy S24',
      id: 'galaxy-s24',
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
    };

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [pixelProduct],
        total: 1,
      });
      return { text: 'Google Pixel 9 is ₦1,450,000.' };
    });
    const pixelResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Best Pixel?' }],
    });
    expect(pixelResult?.events[0]?.products[0]?.id).toBe('pixel-9');

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [galaxyProduct],
        total: 1,
      });
      return { text: 'Samsung Galaxy S24 is ₦1,450,000.' };
    });
    const galaxyResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Any Galaxy?' }],
    });
    expect(galaxyResult?.events[0]?.products[0]?.id).toBe('galaxy-s24');

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
    });
    const gamingResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content: 'Gaming rig?' }],
    });
    expect(gamingResult?.events[0]?.products[0]?.id).toBe('mac-1');

    const sessionIds = mocks.createTools.mock.calls.map(([id]) => id);
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
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

  it('rejects getProductDetails results with non-numeric or missing prices when a budget cap is active', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('getProductDetails', {
        ...sampleProduct,
        id: 'mac-string-price',
        price: '2500000',
      });
      return { text: 'Apple MacBook Air M2 is available now.' };
    });

    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('getProductDetails', {
        ...sampleProduct,
        id: 'mac-missing-price',
        price: undefined,
      });
      return {
        text: "Sorry, I couldn't confirm any matching laptop within your budget.",
      };
    });

    expect(await runOgabasseyCatalogAgent(baseOptions())).toEqual({
      events: [],
      text: "Sorry, I couldn't confirm any matching laptop within your budget.",
    });
  });

  it('rejects unknown-brand multi-token fabrications and fails closed on malformed budget JSON', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Try the Apple MacBook Air M2 or Fairphone 5 for ₦1,450,000.',
      };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

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
    expect(searchSerialized).toEqual({
      products: [],
      total: 0,
      error: 'Unable to validate tool results against budget',
    });
    expect(detailsSerialized).toEqual({
      error: 'Unable to validate product against budget',
    });
  });

  it('validates currency-less scaled prices, abbreviated/qualitative stock claims, and product-price binding', async () => {
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

    // Currency-less scaled fabrication ("1.9m" / "1.9 million")
    for (const text of [
      'Apple MacBook Air M2 costs 1.9m.',
      'Apple MacBook Air M2 costs 1.9 million.',
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

    // Display resolution ("4K display") is not flagged as a price
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 supports a 4K display at ₦1,450,000.',
      };
    });
    expect((await runOgabasseyCatalogAgent(baseOptions()))?.text).toBe(
      'Apple MacBook Air M2 supports a 4K display at ₦1,450,000.'
    );

    // Abbreviated and qualitative stock claims ("only 5 left" / "out of stock")
    for (const text of [
      'Apple MacBook Air M2 is ₦1,450,000—only 5 left.',
      'Apple MacBook Air M2 is out of stock.',
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

    // Swapped product-price pair between two returned products is rejected
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

    // Matching per-product prices in one reply pass
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

  it('requires exact model identity, retains prior valid budgets over invalid follow-ups, and supports DeepSeek-only fallback', async () => {
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
    const overBudgetLaptop = {
      ...sampleProduct,
      id: 'mac-over',
      name: 'Apple MacBook Pro M3',
      price: 2_600_000,
      slug: 'apple-macbook-pro-m3',
    };

    // Returned Apple iPhone 16 must not validate a fabricated "Apple iPhone 15" reply
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
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

    // Invalid budget follow-up ("under $500") retains prior valid "below 2m" cap
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct, overBudgetLaptop],
        total: 2,
      });
      return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
    });
    const retainedBudgetResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [
        { role: 'user', content: 'Show me laptops below 2m' },
        { role: 'assistant', content: 'Checking laptops under ₦2,000,000.' },
        { role: 'user', content: 'Can I get one under $500?' },
      ],
    });
    expect(retainedBudgetResult?.events[0]?.products.map((p) => p.id)).toEqual([
      'mac-1',
    ]);

    // DeepSeek-only configuration uses deepseek:deepseek-flash for read-only search
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

  it('preserves contradictory minPrice floors instead of widening downward and allows honest empty budget restatements', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const rawSearchExecute = vi.fn(
      async (_params: {
        query: string;
        minPrice?: number;
        maxPrice?: number;
      }) => {
        const empty = { products: [], total: 0 };
        reportToolResult?.('searchProducts', empty);
        return JSON.stringify(empty);
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

    mocks.generateText.mockImplementationOnce(
      async (options: {
        tools?: {
          searchProducts?: {
            execute?: (params: {
              query: string;
              minPrice?: number;
              maxPrice?: number;
            }) => Promise<string>;
          };
        };
      }) => {
        await options.tools?.searchProducts?.execute?.({
          query: 'MacBook',
          minPrice: 2_500_000,
        });
        return {
          text: 'Sorry, nothing under ₦2,000,000 matched your search.',
        };
      }
    );

    const emptyRestatement = await runOgabasseyCatalogAgent(baseOptions());
    expect(rawSearchExecute).toHaveBeenCalledWith({
      maxPrice: 2_000_000,
      minPrice: 2_500_000,
      query: 'MacBook',
    });
    expect(emptyRestatement).toEqual({
      events: [],
      text: 'Sorry, nothing under ₦2,000,000 matched your search.',
    });

    // Unmentioned amount in an empty-result reply must still be rejected
    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'Nothing matched at ₦950,000.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
  });
});
