import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import { runOgabasseyConversation } from './ogabassey-conversation';

const options = () => ({
  abortSignal: new AbortController().signal,
  chatProvider: 'auto' as const,
  merchantName: 'Ogabassey',
  merchantSlug: 'ogabassey',
  messages: [{ role: 'user' as const, content: 'Can you help me?' }],
  timeoutMs: 30_000,
});

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

it('does not try a backup after the customer cancels the request', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockImplementation(async () => {
    controller.abort();
    throw new Error('request interrupted');
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(
    runOgabasseyConversation({ ...options(), abortSignal: controller.signal })
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('does not log provider error messages that could contain private data', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('private shopper data'))
  );

  const response = await runOgabasseyConversation(options());

  expect(response?.headers.get('x-baci-chat-fallback')).toBe('static');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private shopper data');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('test-openai-key');
});

it.each([
  ['Shall I add this to your cart?', 'Yes'],
  ['Please provide your delivery name and phone.', 'Jane Doe'],
  ['Shall I add this for you?', 'Go ahead'],
])('keeps short follow-ups on the guarded commerce path: %s', async (prompt, reply) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation({
    ...options(),
    messages: [
      { role: 'assistant', content: prompt },
      { role: 'user', content: reply },
    ],
  });

  expect(result).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  'Your order has been cancelled.',
  'Your payment has been confirmed.',
  'It has been delivered.',
  'I have processed your order.',
  'Your virtual account has been created.',
  'I have done it for you.',
])('rejects an unverified commerce-action claim: %s', async (unsafe) => {
  const reply = (text: string) =>
    new Response(
      JSON.stringify({
        id: 'mock',
        created: 1_700_000_000,
        model: 'model',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: text },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(reply(unsafe))
    .mockResolvedValueOnce(reply('How can I help you?'));
  vi.stubGlobal('fetch', fetchMock);
  const result = await runOgabasseyConversation({
    ...options(),
    messages: [{ role: 'user', content: 'Did you do it?' }],
  });
  expect(await result?.text()).toBe('How can I help you?');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not infer a budget answer from earlier unverified product context', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation({
    ...options(),
    messages: [
      { role: 'user', content: 'I need an iPhone 14 case' },
      { role: 'assistant', content: 'What is your budget?' },
      { role: 'user', content: 'Will ₦50k be enough?' },
    ],
  });

  expect(await result?.text()).toContain('catalog');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not accept a model claim that a cart action was completed', async () => {
  const mockCompletion = (text: string, model: string) =>
    new Response(
      JSON.stringify({
        id: 'mock',
        created: 1_700_000_000,
        model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: text },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      mockCompletion("Done, it's in your cart.", 'gpt-6-luna')
    )
    .mockResolvedValueOnce(
      mockCompletion('How can I help you?', 'deepseek-flash')
    );
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation(options());

  expect(await result?.text()).toBe('How can I help you?');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not let a model recommend an unverified camera', async () => {
  const reply = (text: string) =>
    new Response(
      JSON.stringify({
        id: 'mock',
        created: 1_700_000_000,
        model: 'model',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: text },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(reply('I recommend a Sony camera.'))
    .mockResolvedValueOnce(reply('Please check the catalog.'));
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation(options());

  expect(await result?.text()).toBe('Please check the catalog.');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not invent the store location when it has no verified contact data', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation({
    ...options(),
    messages: [{ role: 'user', content: 'Where is your store located?' }],
  });

  expect(await result?.text()).toContain('contact');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not start a provider after the route deadline is exhausted', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const result = await runOgabasseyConversation({ ...options(), timeoutMs: 0 });

  expect(result?.headers.get('x-baci-chat-fallback')).toBe('static');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('switches to the backup promptly when the primary stalls', async () => {
  const timeoutDurations: number[] = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
    timeoutDurations.push(duration);
    return realTimeout(timeoutDurations.length === 1 ? 10 : duration);
  });
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.openai.com')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'mock',
            created: 1_700_000_000,
            model: 'deepseek-flash',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'How can I help you?' },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );
    });
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation(options());
  expect(await response?.text()).toBe('How can I help you?');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(timeoutDurations[0]).toBeLessThanOrEqual(6_000);
});
