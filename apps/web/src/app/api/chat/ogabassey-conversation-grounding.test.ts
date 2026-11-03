import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import { runOgabasseyConversation } from './ogabassey-conversation';

function completion(text: string, model: string) {
  return new Response(
    JSON.stringify({
      id: 'test-completion',
      created: 1_700_000_000,
      model,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: text },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

const options = () => ({
  abortSignal: new AbortController().signal,
  chatProvider: 'auto' as const,
  merchantName: 'Ogabassey',
  merchantSlug: 'ogabassey',
  messages: [{ role: 'user' as const, content: 'Can you help me?' }],
  timeoutMs: 30_000,
});

describe('Ogabassey conversational providers', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key');
    resetProviderCooldowns();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for gift preferences without suggesting items outside the catalog', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [{ role: 'user', content: 'Can you help me choose a gift?' }],
    });

    expect(await response?.text()).toMatch(/product|budget/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a vague gift follow-up grounded in a catalog search', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [
        { role: 'user', content: 'I need a gift for my friend' },
        { role: 'assistant', content: 'What do they like?' },
        { role: 'user', content: 'How should I decide?' },
      ],
    });

    expect(await response?.text()).toMatch(/product|budget/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent gift ideas in a vague shopping follow-up', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [
        { role: 'user', content: 'I am shopping for a friend.' },
        { role: 'assistant', content: 'What do they like?' },
        { role: 'user', content: 'How should I decide?' },
      ],
    });

    expect(await response?.text()).toMatch(/product|budget/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not recommend an unverified branded accessory from model memory', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completion('I recommend a Samsung case.', 'gpt-6-luna')
      )
      .mockResolvedValueOnce(
        completion('Please check the catalog.', 'deepseek-flash')
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation(options());

    expect(await response?.text()).toBe('Please check the catalog.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a safe response if both models provide unsupported claims', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion('It is ₦100,000.', 'gpt-6-luna'))
      .mockResolvedValueOnce(completion('It is ₦200,000.', 'deepseek-flash'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation(options());

    expect(await response?.text()).not.toMatch(/₦|100,000|200,000/);
    expect(response?.headers.get('x-baci-chat-fallback')).toBe('static');
  });

  it.each([
    'Add this to my cart',
    'Cancel my order',
    'Check my payment status',
  ])('leaves commerce actions to the existing guarded path: %s', async (content) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await runOgabasseyConversation({
      ...options(),
      messages: [{ role: 'user', content }],
    });
    expect(response).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent a recommendation if a catalog request escaped the fast path', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [{ role: 'user', content: 'Which accessories are available?' }],
    });

    expect(await response?.text()).toContain('catalog');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not infer a brand-only catalog answer from model memory', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [{ role: 'user', content: 'Do you sell Apple?' }],
    });

    expect(await response?.text()).toContain('catalog');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not infer compatibility on an ambiguous product follow-up', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [
        { role: 'user', content: 'I need a case for iPhone 14' },
        { role: 'assistant', content: 'Here is a case.' },
        { role: 'user', content: 'Will this fit?' },
      ],
    });

    expect(await response?.text()).toContain('catalog');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers negotiation without inventing a price or discount', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await runOgabasseyConversation({
      ...options(),
      messages: [
        { role: 'user', content: 'What is your last price for iPhone 16?' },
      ],
    });

    expect(await response?.text()).toContain('can’t promise a discount');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not change other stores, explicit provider modes, or keyless environments', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await runOgabasseyConversation({ ...options(), merchantSlug: 'other' })
    ).toBeNull();
    expect(
      await runOgabasseyConversation({ ...options(), chatProvider: 'gemini' })
    ).toBeNull();
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    expect(await runOgabasseyConversation(options())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
