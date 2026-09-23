import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTools: vi.fn(),
  generateText: vi.fn(),
  getTextProviderChain: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('@/app/api/chat/chat-tool-runtime', () => ({
  createAiSdkAgenticChatTools: mocks.createTools,
}));
vi.mock('@/ai/text-provider-chain', () => ({
  getTextProviderChain: mocks.getTextProviderChain,
}));
vi.mock('@/config/agentic-chat-system-prompt', () => ({
  AGENTIC_SYSTEM_PROMPT: 'test system prompt',
}));

import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import type { TextProvider } from '@/ai/text-provider-chain';
import { runChatProviderChain } from './run-chat-provider-chain';

function provider(name: string): TextProvider {
  return {
    model: { id: name } as unknown as TextProvider['model'],
    name,
  };
}

let markSideEffect: ((toolName: string) => void) | undefined;
let reportToolResult: ((toolName: string, result: unknown) => void) | undefined;

describe('runChatProviderChain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderCooldowns();
    markSideEffect = undefined;
    reportToolResult = undefined;
    mocks.createTools.mockImplementation(
      (
        _sessionId: string,
        options: {
          onSideEffect?: (toolName: string) => void;
          onToolResult?: (
            toolName: string,
            result: unknown,
            context?: { quantity?: number }
          ) => void;
        } = {}
      ) => {
        markSideEffect = options.onSideEffect;
        reportToolResult = options.onToolResult;
        return {};
      }
    );
    mocks.getTextProviderChain.mockReturnValue([
      provider('cerebras:gemma-4-31b'),
      provider('google:gemini-2.5-flash'),
      provider('google:gemini-2.5-flash-lite'),
    ]);
  });

  it('falls from Gemini Flash to Flash-Lite without attempting non-tool providers', async () => {
    vi.mocked(generateText).mockImplementation(((options: {
      model: { id: string };
    }) => {
      if (options.model.id === 'google:gemini-2.5-flash') {
        return Promise.reject(new Error('Gemini Flash quota exhausted'));
      }
      return Promise.resolve({ text: 'Flash-Lite response' });
    }) as unknown as typeof generateText);

    const result = await runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'Hello', role: 'user' }],
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      providerName: 'google:gemini-2.5-flash-lite',
      text: 'Flash-Lite response',
    });
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(generateText).mock.calls.map(([options]) => options.model)
    ).toEqual([
      { id: 'google:gemini-2.5-flash' },
      { id: 'google:gemini-2.5-flash-lite' },
    ]);
  });

  it.each([
    false,
    true,
  ])('isolates failed-attempt cards when the successful provider emits cards: %s', async (withCards) => {
    const product = (id: string) => ({
      brand: null,
      category: null,
      description: null,
      has_variants: false,
      id,
      image_url: null,
      manage_stock: false,
      name: id,
      price: 10,
      slug: null,
      status: 'active',
      stock: null,
    });
    let failedReport: typeof reportToolResult;
    vi.mocked(generateText).mockImplementation((async (options: {
      model: { id: string };
    }) => {
      if (options.model.id === 'google:gemini-2.5-flash') {
        failedReport = reportToolResult;
        for (const id of ['failed-1', 'failed-2', 'failed-3']) {
          reportToolResult?.('getProductDetails', product(id));
        }
        throw new Error('failed after tool');
      }
      // A late result from the failed attempt must not affect the active one.
      failedReport?.('getProductDetails', product('late'));
      if (withCards)
        reportToolResult?.('getProductDetails', product('successful'));
      return { text: 'Successful response' };
    }) as unknown as typeof generateText);
    const result = await runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ role: 'user', content: 'Show phones' }],
      sessionId: 'session-1',
    });
    expect(
      result.events?.flatMap((event) => event.products.map(({ id }) => id)) ??
        []
    ).toEqual(withCards ? ['successful'] : []);
  });

  it('uses a configured reliable provider without tools when both Gemini pools fail', async () => {
    mocks.getTextProviderChain.mockReturnValue([
      provider('cerebras:gemma-4-31b'),
      provider('groq:openai/gpt-oss-120b'),
      provider('google:gemini-2.5-flash'),
      provider('google:gemini-2.5-flash-lite'),
    ]);
    vi.mocked(generateText).mockImplementation(((options: {
      model: { id: string };
      tools?: unknown;
      system?: string;
    }) => {
      if (options.model.id === 'google:gemini-2.5-flash') {
        return Promise.reject(new Error('Gemini quota exhausted'));
      }
      if (options.model.id === 'google:gemini-2.5-flash-lite') {
        return Promise.resolve({ text: '   ' });
      }

      return Promise.resolve({ text: 'Cerebras recovery response' });
    }) as unknown as typeof generateText);

    const result = await runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'Hello', role: 'user' }],
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      providerName: 'cerebras:gemma-4-31b',
      text: 'Cerebras recovery response',
    });
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(generateText).mock.calls.map(([options]) => options.model)
    ).toEqual([
      { id: 'google:gemini-2.5-flash' },
      { id: 'google:gemini-2.5-flash-lite' },
      { id: 'cerebras:gemma-4-31b' },
    ]);
    const fallbackOptions = vi.mocked(generateText).mock.calls[2]?.[0];
    expect(fallbackOptions?.tools).toBeUndefined();
    expect(fallbackOptions?.system).toContain(
      'do not have access to live inventory'
    );
  });

  it('stops the chain when a provider fails after a commerce side effect', async () => {
    vi.mocked(generateText).mockImplementation((() => {
      markSideEffect?.('createVirtualAccount');
      return Promise.reject(new Error('provider failed after tool execution'));
    }) as unknown as typeof generateText);

    const attempt = runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'Create a payment account', role: 'user' }],
      sessionId: 'session-1',
    });

    await expect(attempt).rejects.toThrow(
      'provider chain walk stopped after google:gemini-2.5-flash failed'
    );
    expect(vi.mocked(generateText)).toHaveBeenCalledOnce();
  });

  it('returns validated product events collected from a successful tool call', async () => {
    vi.mocked(generateText).mockImplementation((() => {
      reportToolResult?.('searchProducts', {
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
      return Promise.resolve({ text: 'I found one phone.' });
    }) as unknown as typeof generateText);

    const result = await runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'Show me phones', role: 'user' }],
      sessionId: 'session-1',
    });

    expect(result).toEqual({
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
      providerName: 'google:gemini-2.5-flash',
      text: 'I found one phone.',
    });
  });

  it.each([
    false,
    true,
  ])('uses successful tool UI with recovery provider %s when the provider returns no final text', async (withRecovery) => {
    mocks.getTextProviderChain.mockReturnValue([
      provider('google:gemini-2.5-flash'),
      ...(withRecovery ? [provider('groq:recovery')] : []),
    ]);
    vi.mocked(generateText).mockImplementation((() => {
      reportToolResult?.('getProductDetails', {
        brand: 'Apple',
        category: 'Smartphones',
        description: null,
        has_variants: false,
        id: 'product-1',
        image_url: null,
        manage_stock: false,
        name: 'iPhone 16',
        price: 1_200_000,
        slug: 'iphone-16',
        status: 'active',
        stock: null,
      });
      return Promise.resolve({ text: '   ' });
    }) as unknown as typeof generateText);

    const result = await runChatProviderChain({
      abortSignal: new AbortController().signal,
      messages: [{ content: 'Tell me about this phone', role: 'user' }],
      sessionId: 'session-1',
    });

    expect(result.text).toBe(
      'I found these live catalog options for you.\niPhone 16'
    );
    expect(result.events).toHaveLength(1);
    expect(result.providerName).toBe('google:gemini-2.5-flash');
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
