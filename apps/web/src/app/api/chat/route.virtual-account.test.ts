import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextWithChainMock } = vi.hoisted(() => ({
  generateTextWithChainMock: vi.fn(),
}));

let ollamaExecuteDuplicateVirtualAccount = false;

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@/ai/generate-text-with-chain', () => ({
  generateTextWithChain: generateTextWithChainMock,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: () => '127.0.0.1',
  })),
}));

vi.mock('@/ai/provider', () => ({
  ACTIVE_TEXT_MODEL_NAME: 'gemini-2.5-flash',
  FALLBACK_TEXT_MODEL_NAME: 'gemini-2.5-flash-lite',
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  activeTextModel: 'mock-model',
  fallbackTextModel: 'mock-fallback-model',
}));

vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: vi.fn(async () => ({
    agenticCheckoutEnabled: true,
    businessName: 'Demo Store',
    currencyCode: 'NGN',
    merchantId: 'merchant-1',
    merchantSlug: 'demo-store',
    priceNegotiationEnabled: true,
  })),
}));

vi.mock('./fast-catalog-flow', () => ({
  tryFastCatalogChat: vi.fn(async () => null),
}));

vi.mock('@/env', () => ({
  getAiChatProvider: vi.fn(() => 'auto'),
  getAiChatModel: vi.fn(() => 'gemma4:e4b'),
  getOllamaBaseUrl: vi.fn(() => 'https://ollama.example.com'),
  getOllamaBasicAuth: vi.fn(() => undefined),
  getLlmServerUrl: vi.fn(() => undefined),
  getLlmServerBearer: vi.fn(() => undefined),
  getLlmChatModel: vi.fn(() => 'gemma-4-e4b'),
}));

vi.mock('@/lib/llm-chat', () => ({
  createLlmChatResponse: vi.fn(),
}));

vi.mock('@/lib/ollama-agentic-chat', () => ({
  createOllamaAgenticChatResponse: vi.fn(
    async (options: {
      executeToolCall: (call: {
        function: { name: string; arguments?: unknown };
      }) => Promise<string>;
      onToolExecuted?: (
        call: { function: { name: string } },
        result: string
      ) => void;
    }) => {
      if (!ollamaExecuteDuplicateVirtualAccount) {
        return new Response('ok');
      }
      const call = {
        function: { name: 'createVirtualAccount', arguments: {} },
      };
      const firstResult = await options.executeToolCall(call);
      options.onToolExecuted?.(call, firstResult);
      const secondResult = await options.executeToolCall(call);
      options.onToolExecuted?.(call, secondResult);

      return new Response(
        JSON.stringify({
          firstResult: JSON.parse(firstResult),
          secondResult: JSON.parse(secondResult),
        }),
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  ),
}));

vi.mock('@/ai/chat-tool-handlers', () => ({
  handleSearchProducts: vi.fn(async () => ({ products: [] })),
  handleGetProductDetails: vi.fn(async () => ({ product: null })),
  handleCreateVirtualAccount: vi.fn(async () => ({ account: null })),
  handleCheckPaymentStatus: vi.fn(async () => ({ status: 'pending' })),
  handleGetRecommendations: vi.fn(async () => ({ recommendations: [] })),
  handleAddToCart: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/ai/chat-order-cancellation', () => ({
  handleCancelOrder: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/ai/chat-tools', () => ({
  searchProductsSchema: { parse: vi.fn() },
  getProductDetailsSchema: { parse: vi.fn() },
  createVirtualAccountSchema: { parse: vi.fn(() => ({})) },
  checkPaymentStatusSchema: { parse: vi.fn() },
  cancelOrderSchema: { parse: vi.fn() },
  getRecommendationsSchema: { parse: vi.fn() },
  addToCartSchema: { parse: vi.fn() },
  CHECKOUT_TOOL_NAMES: [
    'createVirtualAccount',
    'checkPaymentStatus',
    'cancelOrder',
  ],
  TOOL_DESCRIPTIONS: {
    searchProducts: 'Search products',
    getProductDetails: 'Get product details',
    createVirtualAccount: 'Create virtual account',
    checkPaymentStatus: 'Check payment status',
    cancelOrder: 'Cancel order',
    getRecommendations: 'Get recommendations',
    addToCart: 'Add to cart',
  },
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: vi.fn((input: string) => input),
}));

import { generateText } from 'ai';
import { handleCreateVirtualAccount } from '@/ai/chat-tool-handlers';
import { createVirtualAccountSchema } from '@/ai/chat-tools';
import { POST } from './route';
import { generateRouteChainAttempt } from './route-chain.test-support';

describe('POST /api/chat virtual account duplicate-call guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ollamaExecuteDuplicateVirtualAccount = false;
    generateTextWithChainMock.mockImplementation(generateRouteChainAttempt);
  });

  it('blocks repeated side-effecting Ollama tool execution after an order is created', async () => {
    const args = {};
    ollamaExecuteDuplicateVirtualAccount = true;
    vi.mocked(createVirtualAccountSchema.parse).mockReturnValue(args);
    vi.mocked(handleCreateVirtualAccount).mockResolvedValue({
      success: false,
      orderId: 'order-1',
    });

    const response = await POST(
      new Request('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'og_chat_customer_session_1234',
          messages: [{ role: 'user', content: 'Create payment account' }],
        }),
      })
    );
    const result = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(handleCreateVirtualAccount).toHaveBeenCalledTimes(1);
    expect(handleCreateVirtualAccount).toHaveBeenCalledWith(
      args,
      'og_chat_customer_session_1234'
    );
    expect(result.firstResult).toEqual({
      success: false,
      orderId: 'order-1',
    });
    expect(result.secondResult).toEqual({
      error:
        'createVirtualAccount already completed a commerce action in this chat turn. Use the existing tool result instead of calling it again.',
    });
    expect(generateText).not.toHaveBeenCalled();
  });
});
