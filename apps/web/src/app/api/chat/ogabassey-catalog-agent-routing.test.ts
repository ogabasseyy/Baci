import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';

const mocks = vi.hoisted(() => ({
  createTools: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('./chat-catalog-tools', () => ({
  createReadOnlyCatalogTools: mocks.createTools,
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

describe('runOgabasseyCatalogAgent routing', () => {
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

  it.each([
    'Hello!',
    'Tell me a joke',
    'Tips for photo editing',
    'Why is my number 2 failing?',
    'Can you recommend a restaurant?',
    'Are you available to help?',
    'What is the cost of living?',
    'What products does photosynthesis create?',
    'What devices are used in networking?',
    'What is your WhatsApp number?',
    'What is your last price for iPhone 16?',
    'Cancel my order',
    'Why is my photo pixelated?',
  ])('skips non-catalog or guarded prompts without calling a model: %s', async (content) => {
    vi.stubEnv('META_MODEL_API_KEY', 'test-meta-key');

    const result = await runOgabasseyCatalogAgent({
      ...baseOptions(),
      messages: [{ role: 'user', content }],
    });

    expect(result).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
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
});
