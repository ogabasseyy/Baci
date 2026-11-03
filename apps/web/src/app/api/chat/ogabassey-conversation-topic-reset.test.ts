import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetProviderCooldowns } from '@/ai/provider-cooldown';
import { runOgabasseyConversation } from './ogabassey-conversation';

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

function completion(text: string) {
  return new Response(
    JSON.stringify({
      id: 'test-completion',
      created: 1_700_000_000,
      model: 'gpt-6-luna',
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

it('answers a new topic without sending earlier commerce or personal details to the provider', async () => {
  const fetchMock = vi.fn().mockResolvedValue(completion('Here is a joke.'));
  vi.stubGlobal('fetch', fetchMock);

  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'user', content: 'How do I pay for my order?' },
      { role: 'assistant', content: 'Please provide your delivery name.' },
      { role: 'user', content: 'Jane Doe 07012345678' },
      {
        role: 'assistant',
        content:
          'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.',
      },
      { role: 'user', content: 'Tell me a joke' },
    ],
    timeoutMs: 30_000,
  });

  expect(await response?.text()).toBe('Here is a joke.');
  expect(fetchMock).toHaveBeenCalledOnce();
  const [, init] = fetchMock.mock.calls[0];
  const payload = JSON.parse(String(init.body));
  expect(
    payload.messages.filter(
      (message: { role: string }) => message.role !== 'system'
    )
  ).toEqual([{ role: 'user', content: 'Tell me a joke' }]);
  expect(JSON.stringify(payload)).not.toContain('Jane Doe');
  expect(JSON.stringify(payload)).not.toContain('07012345678');
});

it('keeps an uncertain follow-up out of the provider after commerce', async () => {
  const fetchMock = vi.fn().mockResolvedValue(completion('How can I help?'));
  vi.stubGlobal('fetch', fetchMock);
  const fallback =
    'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.';

  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'user', content: 'How do I pay?' },
      { role: 'assistant', content: 'Please provide your delivery name.' },
      { role: 'user', content: 'Jane Doe 07012345678' },
      { role: 'assistant', content: fallback },
      { role: 'user', content: 'Could you explain more?' },
      { role: 'assistant', content: fallback },
      { role: 'user', content: 'What else can you do?' },
      { role: 'assistant', content: fallback },
      { role: 'user', content: 'Could you say more?' },
    ],
    timeoutMs: 30_000,
  });

  expect(response).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  'Tell me a story',
  'What is artificial intelligence?',
  'What can I do to relax?',
  'What is the weather in Lagos?',
])('sends only an unrelated question after commerce: %s', async (content) => {
  const fetchMock = vi.fn().mockResolvedValue(completion('Happy to help.'));
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'user', content: 'How do I pay for my order?' },
      { role: 'assistant', content: 'Please provide your delivery name.' },
      { role: 'user', content: 'Jane Doe 07012345678' },
      { role: 'user', content },
    ],
    timeoutMs: 30_000,
  });

  expect(await response?.text()).toBe('Happy to help.');
  const [, init] = fetchMock.mock.calls[0];
  const payload = JSON.parse(String(init.body));
  expect(payload.messages.at(-1)).toEqual({ role: 'user', content });
  expect(JSON.stringify(payload)).not.toContain('Jane Doe');
  expect(JSON.stringify(payload)).not.toContain('07012345678');
});

it('continues a new joke after confirmation without forwarding old commerce history', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(completion('Here is another joke.'));
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'user', content: 'How do I pay for my order?' },
      { role: 'assistant', content: 'Please use checkout.' },
      { role: 'user', content: 'Tell me a joke' },
      {
        role: 'assistant',
        content: 'Here is a joke. Would you like another joke?',
      },
      { role: 'user', content: 'Yes' },
    ],
    timeoutMs: 30_000,
  });

  expect(await response?.text()).toBe('Here is another joke.');
  const [, init] = fetchMock.mock.calls[0];
  const payload = JSON.parse(String(init.body));
  expect(payload.messages.at(-1)).toEqual({
    role: 'user',
    content: 'Tell me another joke.',
  });
});

it('does not send unsolicited contact details from earlier general history', async () => {
  const fetchMock = vi.fn().mockResolvedValue(completion('Here is a joke.'));
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'user', content: 'Amaka Okafor 07012345678' },
      { role: 'assistant', content: 'I see.' },
      { role: 'user', content: 'Tell me a joke' },
    ],
    timeoutMs: 30_000,
  });

  expect(await response?.text()).toBe('Here is a joke.');
  const [, init] = fetchMock.mock.calls[0];
  const payload = JSON.parse(String(init.body));
  expect(JSON.stringify(payload)).not.toContain('Amaka Okafor');
  expect(JSON.stringify(payload)).not.toContain('07012345678');
  expect(payload.messages.at(-1)).toEqual({
    role: 'user',
    content: 'Tell me a joke',
  });
});

it.each([
  [
    'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.',
    'Jane Doe',
  ],
  ['What is your full name and phone number?', 'My phone is 080 123 456 789'],
])('does not send a personal reply after assistant guidance or solicitation', async (prompt, content) => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const response = await runOgabasseyConversation({
    abortSignal: new AbortController().signal,
    chatProvider: 'auto',
    merchantName: 'Ogabassey',
    merchantSlug: 'ogabassey',
    messages: [
      { role: 'assistant', content: prompt },
      { role: 'user', content },
    ],
    timeoutMs: 30_000,
  });

  expect(response).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
