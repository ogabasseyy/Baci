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
  buildAgenticSystemPrompt: vi.fn(() => 'test system prompt'),
}));

import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import type { TextProvider } from '@/ai/text-provider-chain';
import { runChatProviderChain } from './run-chat-provider-chain';

let markSideEffect: ((toolName: string) => void) | undefined;

describe('runChatProviderChain stopWhen behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderCooldowns();
    markSideEffect = undefined;
    mocks.createTools.mockImplementation(
      (
        _sessionId: string,
        options: { onSideEffect?: (toolName: string) => void } = {}
      ) => {
        markSideEffect = options.onSideEffect;
        return {};
      }
    );
    mocks.getTextProviderChain.mockReturnValue([
      {
        model: {
          id: 'google:gemini-2.5-flash',
        } as unknown as TextProvider['model'],
        name: 'google:gemini-2.5-flash',
      },
    ]);
  });

  it('passes a multi-step stopWhen condition so tool calls synthesize a final answer', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: 'Found matching MacBooks.',
    } as never);

    await runChatProviderChain({
      abortSignal: new AbortController().signal,
      agenticCheckoutEnabled: true,
      currency: { code: 'NGN', locale: 'en-NG', symbol: '₦' },
      merchantName: 'Demo Store',
      messages: [{ content: 'Show macbooks below 2m', role: 'user' }],
      sessionId: 'session-1',
      timeoutMs: 60_000,
    });

    const callOptions = vi.mocked(generateText).mock.calls[0]?.[0];
    expect(typeof callOptions?.stopWhen).toBe('function');
    const stopCondition = callOptions?.stopWhen as (context: {
      steps: unknown[];
    }) => boolean;
    expect(stopCondition({ steps: [{}] })).toBe(false);
    expect(stopCondition({ steps: [{}, {}, {}, {}, {}] })).toBe(true);

    markSideEffect?.('cancelOrder');
    expect(stopCondition({ steps: [{}] })).toBe(true);
  });
});
