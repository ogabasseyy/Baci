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

describe('runOgabasseyCatalogAgent price and stock grounding', () => {
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

  it('rejects ungrounded replies when no catalog tools run or search returns empty', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');
    mocks.generateText.mockResolvedValueOnce({
      text: 'Try the MacBook Air M2 for ₦1,450,000.',
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', { products: [], total: 0 });
      return { text: 'It costs ₦950,000 and is available now.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
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
      return { text: 'Apple MacBook Air M2 is ₦950,000.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [sampleProduct],
        total: 1,
      });
      return { text: 'Apple MacBook Air M2 has 12 units available.' };
    });
    expect(await runOgabasseyCatalogAgent(baseOptions())).toBeNull();
  });

  it('rejects budget-echo prices, model-number prices, bare prices, and short cued prices', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    for (const [text, messages] of [
      ['The Apple MacBook Air M2 is ₦2,000,000.', baseOptions().messages],
      [
        'This iPhone 16 option is ₦16.',
        [{ role: 'user' as const, content: 'Show me iPhone 16 options' }],
      ],
      ['Apple MacBook Air M2 costs 950000.', baseOptions().messages],
      ['Apple MacBook Air M2 costs 999.', baseOptions().messages],
    ] as const) {
      mocks.generateText.mockImplementationOnce(async () => {
        reportToolResult?.('searchProducts', {
          products: [sampleProduct],
          total: 1,
        });
        return { text };
      });
      expect(
        await runOgabasseyCatalogAgent({
          ...baseOptions(),
          messages: [...messages],
        })
      ).toBeNull();
    }

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [
          {
            ...sampleProduct,
            description: 'Apple MacBook Air M2 with 1080p webcam',
          },
        ],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 (2025) with 1080p webcam is ₦1,450,000.',
      };
    });
    expect((await runOgabasseyCatalogAgent(baseOptions()))?.text).toBe(
      'Apple MacBook Air M2 (2025) with 1080p webcam is ₦1,450,000.'
    );
  });

  it('validates currency-less scaled prices, foreign currency symbols, and qualitative stock claims', async () => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    for (const text of [
      'Apple MacBook Air M2 costs 1.9m.',
      'Apple MacBook Air M2 costs 1.9 million.',
      'Apple MacBook Air M2 is $1,450,000.',
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

    mocks.generateText.mockImplementationOnce(async () => {
      reportToolResult?.('searchProducts', {
        products: [
          {
            ...sampleProduct,
            description: 'Apple MacBook Air M2 with 4K display support',
          },
        ],
        total: 1,
      });
      return {
        text: 'Apple MacBook Air M2 supports a 4K display at ₦1,450,000.',
      };
    });
    expect((await runOgabasseyCatalogAgent(baseOptions()))?.text).toBe(
      'Apple MacBook Air M2 supports a 4K display at ₦1,450,000.'
    );
  });
});
