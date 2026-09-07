import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextWithChainMock } = vi.hoisted(() => ({
  generateTextWithChainMock: vi.fn(),
}));

// ---- Test fixtures ----
const TEST_LLM_SERVER_URL = 'https://llm.example.com';
const TEST_LLM_SERVER_BEARER = 'a'.repeat(64);

// ---- Module-scope mutable state for controlling mocks ----
let rateLimitAllowed = true;
let rateLimitResetIn = 0;
let generateTextResult = { text: 'AI response' };
let generateTextError: Error | null = null;
let ollamaBaseUrl: string | undefined;
let ollamaBasicAuth: string | undefined;
let ollamaExecutedToolNameBeforeFailure: string | null = null;
let ollamaExecutedToolResultBeforeFailure: string | null = null;
let ollamaExecuteDuplicateVirtualAccount = false;
let ollamaError: Error | null = null;
let ollamaStreamError: Error | null = null;
let ollamaResponseText = 'Gemma response';
let llmServerUrl: string | undefined;
let llmServerBearer: string | undefined;
let llmChatModel = 'gemma-4-e4b';
let llmError: Error | null = null;
let llmStreamError: Error | null = null;
let llmResponseText = 'LLM response';
let chatProvider: 'auto' | 'gemini' | 'llm' | 'ollama' = 'auto';

// ---- Mocks ----

vi.mock('ai', () => ({
  generateText: vi.fn(() => {
    if (generateTextError) throw generateTextError;
    return Promise.resolve(generateTextResult);
  }),
}));

vi.mock('@/ai/generate-text-with-chain', () => ({
  generateTextWithChain: generateTextWithChainMock,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => {
      if (name === 'x-forwarded-for') return '127.0.0.1';
      if (name === 'x-real-ip') return '127.0.0.1';
      return null;
    },
  })),
}));

vi.mock('@/ai/provider', () => ({
  ACTIVE_TEXT_MODEL_NAME: 'gemini-2.5-flash',
  FALLBACK_TEXT_MODEL_NAME: 'gemini-2.5-flash-lite',
  checkRateLimit: vi.fn(() =>
    rateLimitAllowed
      ? { allowed: true }
      : { allowed: false, resetIn: rateLimitResetIn }
  ),
  activeTextModel: 'mock-model',
  fallbackTextModel: 'mock-fallback-model',
}));

vi.mock('@/env', () => ({
  getAiChatProvider: vi.fn(() => chatProvider),
  getAiChatModel: vi.fn(() => 'gemma4:e4b'),
  getOllamaBaseUrl: vi.fn(() => ollamaBaseUrl),
  getOllamaBasicAuth: vi.fn(() => ollamaBasicAuth),
  getLlmServerUrl: vi.fn(() => llmServerUrl),
  getLlmServerBearer: vi.fn(() => llmServerBearer),
  getLlmChatModel: vi.fn(() => llmChatModel),
}));

vi.mock('@/lib/llm-chat', () => ({
  createLlmChatResponse: vi.fn(() => {
    if (llmError) {
      return Promise.reject(llmError);
    }

    if (llmStreamError) {
      const streamError = llmStreamError;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(streamError);
            },
          }),
          {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }
        )
      );
    }

    return Promise.resolve(
      new Response(llmResponseText, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }),
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
      if (ollamaExecuteDuplicateVirtualAccount) {
        const call = {
          function: {
            name: 'createVirtualAccount',
            arguments: {
              amount: 50_000,
              customerEmail: 'buyer@example.com',
              customerName: 'Buyer',
              items: [
                {
                  productId: 'p1',
                  name: 'iPhone 11',
                  price: 50_000,
                  quantity: 1,
                },
              ],
            },
          },
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
          {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }
        );
      }

      if (ollamaExecutedToolNameBeforeFailure) {
        options.onToolExecuted?.(
          {
            function: { name: ollamaExecutedToolNameBeforeFailure },
          },
          ollamaExecutedToolResultBeforeFailure ?? JSON.stringify({})
        );
      }

      if (ollamaError) {
        return Promise.reject(ollamaError);
      }

      if (ollamaStreamError) {
        const streamError = ollamaStreamError;

        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(streamError);
              },
            }),
            {
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }
          )
        );
      }

      return Promise.resolve(
        new Response(ollamaResponseText, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
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
  handleCancelOrder: vi.fn(async () => ({
    success: true,
    status: 'cancelled',
    orderId: 'order-1',
  })),
}));

vi.mock('@/ai/chat-tools', () => ({
  searchProductsSchema: { parse: vi.fn() },
  getProductDetailsSchema: { parse: vi.fn() },
  createVirtualAccountSchema: { parse: vi.fn() },
  checkPaymentStatusSchema: { parse: vi.fn() },
  cancelOrderSchema: { parse: vi.fn() },
  getRecommendationsSchema: { parse: vi.fn() },
  addToCartSchema: { parse: vi.fn() },
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

// ---- Import handler AFTER mocks ----
import { generateText } from 'ai';
import { handleCreateVirtualAccount } from '@/ai/chat-tool-handlers';
import { createVirtualAccountSchema } from '@/ai/chat-tools';
import { getAiChatModel } from '@/env';
import { createLlmChatResponse } from '@/lib/llm-chat';
import { createOllamaAgenticChatResponse } from '@/lib/ollama-agentic-chat';
import { sanitizeHtml } from '@/lib/sanitize';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import { POST } from './route';
import { generateRouteChainAttempt } from './route-chain.test-support';

// ---- Helpers ----

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeAgentUiRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      Accept: storefrontAgentUiContract.mediaType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function makeAbortedRequest(body: unknown): Request {
  const controller = new AbortController();
  const request = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  controller.abort();
  return request;
}

function makeInvalidJsonRequest(): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json',
  });
}

// ---- Tests ----

describe('POST /api/chat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitAllowed = true;
    rateLimitResetIn = 0;
    generateTextResult = { text: 'AI response' };
    generateTextError = null;
    ollamaBaseUrl = undefined;
    ollamaBasicAuth = undefined;
    ollamaExecutedToolNameBeforeFailure = null;
    ollamaExecutedToolResultBeforeFailure = null;
    ollamaExecuteDuplicateVirtualAccount = false;
    ollamaError = null;
    ollamaStreamError = null;
    ollamaResponseText = 'Gemma response';
    llmServerUrl = undefined;
    llmServerBearer = undefined;
    llmChatModel = 'gemma-4-e4b';
    llmError = null;
    llmStreamError = null;
    llmResponseText = 'LLM response';
    chatProvider = 'auto';
    generateTextWithChainMock.mockImplementation(generateRouteChainAttempt);
  });

  it('returns 429 when rate limited', async () => {
    // Arrange
    rateLimitAllowed = false;
    rateLimitResetIn = 45;

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );
    const json = await response.json();

    // Assert
    expect(response.status).toBe(429);
    expect(json.error).toBe('Too many requests');
    expect(json.resetIn).toBe(45);
  });

  it('returns 400 for invalid JSON', async () => {
    // Act
    const response = await POST(makeInvalidJsonRequest());
    const json = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid JSON');
  });

  it('returns 400 for missing messages', async () => {
    // Act
    const response = await POST(makeRequest({}));
    const json = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
  });

  it('returns 400 for empty messages array', async () => {
    // Act
    const response = await POST(makeRequest({ messages: [] }));
    const json = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
  });

  it('returns 400 for an invalid browser session id', async () => {
    // Act
    const response = await POST(
      makeRequest({
        sessionId: 'bad session',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );
    const json = await response.json();

    // Assert
    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid input');
  });

  it('returns 200 with text/plain response on success', async () => {
    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );
    const text = await response.text();
    expect(text).toBe('AI response');
  });

  it.each([
    null,
    'generation',
    'stream',
  ] as const)('returns trusted product UI events with failure: %s', async (failure) => {
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaResponseText = 'I found one phone.';
    if (failure === 'generation') ollamaError = new Error('generation failed');
    if (failure === 'stream') ollamaStreamError = new Error('stream failed');
    ollamaExecutedToolNameBeforeFailure = 'searchProducts';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      products: [
        {
          brand: 'Apple',
          category: 'Smartphones',
          description: 'Current catalog product',
          has_variants: false,
          id: 'product-1',
          image_url: 'https://cdn.example.com/iphone.jpg',
          manage_stock: true,
          name: 'iPhone 16',
          price: 1_200_000,
          slug: 'iphone-16',
          status: 'active',
          stock: 3,
        },
      ],
      total: 1,
    });

    const response = await POST(
      makeAgentUiRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    expect(response.headers.get('content-type')).toBe(
      `${storefrontAgentUiContract.mediaType}; charset=utf-8`
    );
    expect(await response.json()).toEqual({
      events: [
        expect.objectContaining({
          intent: 'discover',
          products: [
            expect.objectContaining({
              id: 'product-1',
              name: 'iPhone 16',
            }),
          ],
          type: 'present_products',
        }),
      ],
      text: failure
        ? 'I found these live catalog options for you.'
        : 'I found one phone.',
      version: 1,
    });
  });

  it('uses VPS Gemma through Ollama when configured', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Gemma response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://ollama.example.com',
        model: 'gemma4:e4b',
        tools: expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({ name: 'searchProducts' }),
          }),
          expect.objectContaining({
            function: expect.objectContaining({ name: 'createVirtualAccount' }),
          }),
        ]),
        executeToolCall: expect.any(Function),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('VPS-hosted gemma4:e4b'),
          }),
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('commerce tools'),
          }),
          expect.objectContaining({
            role: 'user',
            content: 'Show me phones',
          }),
        ]),
      })
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it('uses Gemini directly when configured to skip self-hosted providers', async () => {
    // Arrange
    chatProvider = 'gemini';
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    ollamaBaseUrl = 'https://ollama.example.com';

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('AI response');
    expect(createLlmChatResponse).not.toHaveBeenCalled();
    expect(createOllamaAgenticChatResponse).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledOnce();
  });

  it('falls back to Gemini when the Ollama request fails', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaError = new Error('Ollama unavailable');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 60_000,
      })
    );
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Ollama unavailable'
    );
  });

  it('returns a static fallback when Ollama fails after a side-effecting tool executes', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'createVirtualAccount';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      success: false,
      orderId: 'order-1',
    });
    ollamaError = new Error('Chat returned an empty completion');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Create payment account' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed after executing commerce tools; returning static fallback:',
      'Chat returned an empty completion'
    );
  });

  it('returns a static fallback when Ollama creates a virtual account without an order id', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'createVirtualAccount';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      success: true,
      accountNumber: '1234567890',
    });
    ollamaError = new Error('Chat returned an empty completion');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Create payment account' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed after executing commerce tools; returning static fallback:',
      'Chat returned an empty completion'
    );
  });

  it('blocks repeated side-effecting Ollama tool execution after an order is created', async () => {
    // Arrange
    const args = {
      amount: 50_000,
      customerEmail: 'buyer@example.com',
      customerName: 'Buyer',
      items: [
        { productId: 'p1', name: 'iPhone 11', price: 50_000, quantity: 1 },
      ],
    };
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecuteDuplicateVirtualAccount = true;
    vi.mocked(createVirtualAccountSchema.parse).mockReturnValue(args);
    vi.mocked(handleCreateVirtualAccount).mockResolvedValue({
      success: false,
      orderId: 'order-1',
    });

    // Act
    const response = await POST(
      makeRequest({
        sessionId: 'og_chat_customer_session_1234',
        messages: [{ role: 'user', content: 'Create payment account' }],
      })
    );
    const text = await response.text();
    const result = JSON.parse(text);

    // Assert
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

  it('returns a static fallback when Ollama fails after canceling an order', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'cancelOrder';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      success: true,
      status: 'cancelled',
      orderId: 'order-1',
    });
    ollamaError = new Error('Chat returned an empty completion');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Cancel my order' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed after executing commerce tools; returning static fallback:',
      'Chat returned an empty completion'
    );
  });

  it('falls back to Gemini when cancelOrder did not mutate the order', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'cancelOrder';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      success: false,
      status: 'not_cancellable',
      orderId: 'order-1',
    });
    ollamaError = new Error('Chat returned an empty completion');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Cancel my order' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Chat returned an empty completion'
    );
  });

  it('falls back to Gemini when a side-effecting Ollama tool only returned a validation error', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'createVirtualAccount';
    ollamaExecutedToolResultBeforeFailure = JSON.stringify({
      error: 'Invalid tool arguments',
    });
    ollamaError = new Error('Chat returned an empty completion');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Create payment account' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Chat returned an empty completion'
    );
  });

  it('still falls back to Gemini when Ollama fails after a read-only tool executes', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaExecutedToolNameBeforeFailure = 'searchProducts';
    ollamaError = new Error('Ollama unavailable after search');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Ollama unavailable after search'
    );
  });

  it('returns a static chat fallback when Ollama and Gemini are unavailable', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaError = new Error('Ollama chat request timed out');
    generateTextError = new Error('Gemini quota exhausted');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Ollama chat request timed out'
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Cloud provider fallback failed; returning static response:',
      'Gemini quota exhausted'
    );
  });

  it('does not fall back to Gemini when Ollama config resolution fails', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    vi.mocked(getAiChatModel).mockImplementationOnce(() => {
      throw new Error('Invalid Ollama model config');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const json = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(json.error).toBe('Internal server error');
    expect(createOllamaAgenticChatResponse).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('does not fall back to Gemini when the client aborts the Ollama request', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaError = new Error('Ollama chat request aborted');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeAbortedRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const json = await response.json();

    // Assert
    expect(response.status).toBe(499);
    expect(json.error).toBe('Client Closed Request');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when Ollama raises an internal AbortError', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaError = new Error('Ollama upstream timed out');
    ollamaError.name = 'AbortError';
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Ollama upstream timed out'
    );
  });

  it('falls back to Gemini when the Ollama stream fails before completion', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaStreamError = new Error(
      'Invalid Ollama chat chunk JSON: Unexpected end of JSON input; payloadLength=42'
    );
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Invalid Ollama chat chunk JSON: Unexpected end of JSON input; payloadLength=42'
    );
  });

  it('falls back to Gemini when Ollama returns an empty completion', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaResponseText = '   ';
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Ollama request failed; falling back to Gemini:',
      'Chat returned an empty completion'
    );
  });

  it('forwards Ollama Basic Auth when configured', async () => {
    // Arrange
    ollamaBaseUrl = 'https://ollama.example.com';
    ollamaBasicAuth = 'user:password';

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        basicAuth: 'user:password',
      })
    );
  });

  it('sanitizes user messages', async () => {
    // Act
    await POST(
      makeRequest({
        messages: [
          { role: 'user', content: '<img onerror=alert(1)>' },
          { role: 'assistant', content: 'Hello!' },
        ],
      })
    );

    // Assert
    expect(sanitizeHtml).toHaveBeenCalledWith('<img onerror=alert(1)>');
    expect(sanitizeHtml).not.toHaveBeenCalledWith('Hello!');
  });

  it('passes all 7 tools to generateText', async () => {
    // Act
    await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Find a laptop' }],
      })
    );

    // Assert
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        system: expect.stringContaining('Ogabassey AI'),
        tools: expect.objectContaining({
          searchProducts: expect.objectContaining({
            description: 'Search products',
          }),
          getProductDetails: expect.objectContaining({
            description: 'Get product details',
          }),
          createVirtualAccount: expect.objectContaining({
            description: 'Create virtual account',
          }),
          checkPaymentStatus: expect.objectContaining({
            description: 'Check payment status',
          }),
          cancelOrder: expect.objectContaining({
            description: 'Cancel order',
          }),
          getRecommendations: expect.objectContaining({
            description: 'Get recommendations',
          }),
          addToCart: expect.objectContaining({
            description: 'Add to cart',
          }),
        }),
      })
    );
  });

  it('returns a static chat fallback when Gemini generation fails', async () => {
    // Arrange
    generateTextError = new Error('Model unavailable');
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Act
    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    );
    const text = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
    expect(errorSpy).toHaveBeenCalledWith(
      '[Agentic Chat] Cloud provider fallback failed; returning static response:',
      'Model unavailable'
    );
  });

  it('returns a static chat fallback when Gemini returns empty text', async () => {
    generateTextResult = { text: '   ' };

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(text).toContain('AI assistant is temporarily busy');
  });

  it('preserves client abort handling when Gemini generation aborts', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    generateTextError = abortError;
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeAbortedRequest({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    );
    const json = await response.json();

    expect(response.status).toBe(499);
    expect(json.error).toBe('Client Closed Request');
    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // ---- LLM server (llama.cpp / OpenAI-compatible) cases ----

  it('uses the LLM server when LLM_SERVER_URL is configured', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Show me phones' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('LLM response');
    expect(createLlmChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: TEST_LLM_SERVER_URL,
        bearer: TEST_LLM_SERVER_BEARER,
        model: 'gemma-4-e4b',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('VPS-hosted gemma-4-e4b'),
          }),
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('cannot access live inventory'),
          }),
          expect.objectContaining({
            role: 'user',
            content: 'Show me phones',
          }),
        ]),
      })
    );
    const llmMessages = vi.mocked(createLlmChatResponse).mock.calls[0]?.[0]
      .messages;
    expect(llmMessages?.[0]?.content).not.toContain('commerce tools');
    expect(createOllamaAgenticChatResponse).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('prefers LLM server over Ollama when both are configured', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    ollamaBaseUrl = 'https://ollama.example.com';

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('LLM response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(createOllamaAgenticChatResponse).not.toHaveBeenCalled();
  });

  it('uses Ollama when explicitly configured even if the LLM server is present', async () => {
    chatProvider = 'ollama';
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    ollamaBaseUrl = 'https://ollama.example.com';

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Gemma response');
    expect(createLlmChatResponse).not.toHaveBeenCalled();
    expect(createOllamaAgenticChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when the LLM server request fails', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    llmError = new Error('LLM chat returned 502');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('AI response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] LLM server request failed; falling back to Gemini:',
      'LLM chat returned 502'
    );
  });

  it('falls back to Gemini when the LLM stream errors mid-flight', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    llmStreamError = new Error('Invalid LLM chat chunk JSON');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('AI response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] LLM server request failed; falling back to Gemini:',
      'Invalid LLM chat chunk JSON'
    );
  });

  it('falls back to Gemini when the LLM server returns an empty completion', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    llmResponseText = '   ';
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('AI response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] LLM server request failed; falling back to Gemini:',
      'Chat returned an empty completion'
    );
  });

  it('does not fall back to Gemini when the client aborts the LLM request', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    llmError = new Error('LLM chat request aborted');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeAbortedRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );
    const json = await response.json();

    expect(response.status).toBe(499);
    expect(json.error).toBe('Client Closed Request');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when the LLM server raises an internal AbortError', async () => {
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    llmError = new Error('LLM upstream timed out');
    llmError.name = 'AbortError';
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe('AI response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Agentic Chat] LLM server request failed; falling back to Gemini:',
      'LLM upstream timed out'
    );
  });

  it('does not fall back to Ollama when the LLM server fails (only to Gemini)', async () => {
    // Rationale: a misbehaving LLM server is a problem to surface, not silently
    // re-route to a stale Ollama. Two-step fallback adds latency without value
    // since Gemini is the durable safety net.
    llmServerUrl = TEST_LLM_SERVER_URL;
    llmServerBearer = TEST_LLM_SERVER_BEARER;
    ollamaBaseUrl = 'https://ollama.example.com';
    llmError = new Error('LLM chat returned 503');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('AI response');
    expect(createLlmChatResponse).toHaveBeenCalledOnce();
    expect(createOllamaAgenticChatResponse).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledOnce();
  });
});
