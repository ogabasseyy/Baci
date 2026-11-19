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

it('accepts a truthful explanation that the model has no inventory access', async () => {
  const completion = new Response(
    JSON.stringify({
      id: 'mock',
      created: 1_700_000_000,
      model: 'gpt-6-luna',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content:
              'I have no access to live inventory. Please check the catalog.',
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const fetchMock = vi.fn().mockResolvedValue(completion);
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation(options());
  expect(await response?.text()).toContain('I have no access');
  expect(fetchMock).toHaveBeenCalledOnce();
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

it('rejects a model assertion that a specific product can be bought from the store', async () => {
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
      mockCompletion(
        'You can buy a Nintendo Switch from us right now.',
        'gpt-6-luna'
      )
    )
    .mockResolvedValueOnce(
      mockCompletion('Please check the catalog.', 'deepseek-flash')
    );
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation(options());
  expect(await response?.text()).toBe('Please check the catalog.');
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
