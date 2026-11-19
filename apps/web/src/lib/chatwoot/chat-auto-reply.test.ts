import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  history: vi.fn(),
  post: vi.fn(),
  status: vi.fn(),
  labels: vi.fn(),
}));
vi.mock('@/ai/chat-auto-reply', () => ({
  generateChatAutoReply: mocks.generate,
}));
vi.mock('./chat-auto-reply-history', () => ({
  loadChatAutoReplyHistory: mocks.history,
}));
vi.mock('./chat-auto-reply-client', () => ({
  postAssistantMessage: mocks.post,
  setConversationStatus: mocks.status,
  setConversationLabels: mocks.labels,
}));

import { recordMerchantTakeover, runChatAutoReply } from './chat-auto-reply';

const binding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  accountId: 2,
  inboxId: 20,
  apiAccessToken: 'synthetic-agent-token-aaaa',
  botApiAccessToken: 'synthetic-bot-token-bbbb',
  apiOrigin: 'https://chat.example.test',
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    event: 'message_created' as const,
    id: 100,
    message_type: 'incoming',
    private: false,
    content: 'Do you have the Demo Phone X?',
    account: { id: 2 },
    inbox: { id: 20 },
    conversation: { id: 7, status: 'pending', labels: ['vip'] },
    sender: { name: 'Ada', type: 'contact' },
    ...overrides,
  };
}

const draft = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  reply: {
    reply: 'Yes, it is in stock.',
    confidence: 0.9,
    needsHuman: false,
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.history.mockResolvedValue([]);
  mocks.post.mockResolvedValue(true);
  mocks.status.mockResolvedValue(true);
  mocks.labels.mockResolvedValue(true);
  mocks.generate.mockResolvedValue(draft());
});

describe('runChatAutoReply', () => {
  it('replies and records the conversation as handled by the assistant', async () => {
    expect(await runChatAutoReply(binding, event())).toBe('replied');
    expect(mocks.post).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      content: 'Yes, it is in stock.',
    });
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'handled-by-ai'],
    });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('does nothing when a person owns the conversation', async () => {
    const open = event({ conversation: { id: 7, status: 'open', labels: [] } });
    expect(await runChatAutoReply(binding, open)).toBe('skipped');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('hands over without asking the model when the customer wants a person', async () => {
    const wants = event({ content: 'let me talk to a human' });
    expect(await runChatAutoReply(binding, wants)).toBe('handed_over');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      status: 'open',
    });
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'needs-human'],
    });
  });

  it('tells the customer, opens the queue and leaves a private staff note', async () => {
    await runChatAutoReply(binding, event({ content: 'real person please' }));
    const [told, note] = mocks.post.mock.calls.map((call) => call[1]);
    expect(told.content).toMatch(/passing this to our team/i);
    expect(told.isPrivate).toBeUndefined();
    expect(note.isPrivate).toBe(true);
    expect(mocks.status).toHaveBeenCalledOnce();
  });

  it('hands over when confidence is low and never sends the guess', async () => {
    mocks.generate.mockResolvedValue(draft({ confidence: 0.3 }));
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
    expect(
      mocks.post.mock.calls.some(
        (call) => call[1].content === 'Yes, it is in stock.'
      )
    ).toBe(false);
  });

  it('hands over when the model says the question needs a person', async () => {
    mocks.generate.mockResolvedValue(draft({ needsHuman: true, reply: '' }));
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
  });

  it('hands over when the model is unavailable or rate limited', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
  });

  it('reports failure when the reply could not be posted, without labelling', async () => {
    mocks.post.mockResolvedValue(false);
    expect(await runChatAutoReply(binding, event())).toBe('failed');
    expect(mocks.labels).not.toHaveBeenCalled();
  });

  it('reports failure when the hand-over could not reach the customer', async () => {
    mocks.post.mockResolvedValue(false);
    expect(
      await runChatAutoReply(binding, event({ content: 'agent please' }))
    ).toBe('failed');
  });
});

describe('recordMerchantTakeover', () => {
  const staff = (status: string) =>
    event({
      message_type: 'outgoing',
      sender: { name: 'Staff', type: 'user' },
      conversation: { id: 7, status, labels: ['handled-by-ai', 'vip'] },
    });

  it('moves a pending conversation to the queue and switches the label', async () => {
    expect(await recordMerchantTakeover(binding, staff('pending'))).toBe(
      'replied'
    );
    expect(mocks.status).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      status: 'open',
    });
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'handled-by-merchant'],
    });
  });

  it('only relabels a conversation that is already open', async () => {
    await recordMerchantTakeover(binding, staff('open'));
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.labels).toHaveBeenCalledOnce();
  });

  it('ignores the assistant bot and private notes', async () => {
    const bot = event({
      message_type: 'outgoing',
      sender: { type: 'agent_bot' },
    });
    expect(await recordMerchantTakeover(binding, bot)).toBe('skipped');
    expect(mocks.labels).not.toHaveBeenCalled();
  });
});
