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

describe('runOgabasseyCatalogAgent budget edge cases', () => {
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

    // Missing price without a searchProducts call must also fail closed
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

    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
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

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'Nothing matched at ₦950,000.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
  });

  it('fails closed on invalid budget follow-ups and preserves valid budgets across non-price over filters', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    const overBudgetLaptop = {
      ...sampleProduct,
      id: 'mac-over-spec',
      name: 'Apple MacBook Pro M3 512GB',
      price: 2_600_000,
      slug: 'apple-macbook-pro-m3-512gb',
    };

    expect(
      await runOgabasseyCatalogAgent({
        ...baseOptions(),
        messages: [
          { role: 'user', content: 'Show me laptops below 2m' },
          { role: 'assistant', content: 'Checking laptops under ₦2,000,000.' },
          { role: 'user', content: 'Can I get one under $500?' },
        ],
      })
    ).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct, overBudgetLaptop],
        total: 2,
      });
      return { text: 'Apple MacBook Air M2 is ₦1,450,000.' };
    });
    const specFollowUpResult = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [
        { role: 'user', content: 'Show laptops under ₦2m' },
        { role: 'assistant', content: 'Checking laptops under ₦2,000,000.' },
        { role: 'user', content: 'Show laptops with storage over 512GB' },
      ],
    });
    expect(specFollowUpResult?.events[0]?.products.map((p) => p.id)).toEqual([
      'mac-1',
    ]);
  });
});
