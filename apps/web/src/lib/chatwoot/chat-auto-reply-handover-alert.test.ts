import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  history: vi.fn(),
  latest: vi.fn(),
  post: vi.fn(),
  status: vi.fn(),
  labels: vi.fn(),
  snapshot: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('./chat-handover-alert', () => ({
  alertMerchantOfHandover: mocks.alert,
}));
vi.mock('@/ai/chat-auto-reply', () => ({
  generateChatAutoReply: mocks.generate,
}));
vi.mock('./chat-auto-reply-history', () => ({
  loadChatAutoReplyHistory: mocks.history,
  isLatestChatMessage: mocks.latest,
}));
vi.mock('./chat-auto-reply-client', () => ({
  postAssistantMessage: mocks.post,
  setConversationStatus: mocks.status,
  setConversationLabels: mocks.labels,
  getConversationSnapshot: mocks.snapshot,
}));

import { runChatAutoReply } from './chat-auto-reply';

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
  mocks.latest.mockResolvedValue(true);
  mocks.post.mockResolvedValue(true);
  mocks.status.mockResolvedValue(true);
  mocks.labels.mockResolvedValue(true);
  mocks.generate.mockResolvedValue(draft());
  mocks.snapshot.mockResolvedValue({ status: 'pending', labels: ['vip'] });
  mocks.alert.mockResolvedValue('notified');
});

describe('bugfix: a handover must alert the merchant', () => {
  const alerted = {
    merchantId: binding.merchantId,
    eventKey: 'chat-handover-2-100',
    conversationId: 7,
    customerName: 'Ada',
  };

  it.each([
    [
      'the customer asks for a person',
      event({ content: 'agent please' }),
      null,
    ],
    [
      'the customer sends only an attachment',
      event({ content: '', attachments: [{ file_type: 'image' }] }),
      null,
    ],
    ['the model says it needs a person', event(), { needsHuman: true }],
    ['the model is not confident', event(), { confidence: 0.2 }],
  ])('alerts the merchant when %s', async (_label, incoming, over) => {
    if (over) mocks.generate.mockResolvedValue(draft(over));
    expect(await runChatAutoReply(binding, incoming)).toBe('handed_over');
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(alerted);
  });

  it('alerts the merchant when the model is unavailable', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(alerted);
  });

  it('alerts the merchant when the reply is rejected and a person must take over', async () => {
    mocks.post.mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
    expect(mocks.alert).toHaveBeenCalledExactlyOnceWith(alerted);
  });

  it('uses no customer name when the customer has none', async () => {
    await runChatAutoReply(
      binding,
      event({ content: 'agent please', sender: { type: 'contact' } })
    );
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: '' })
    );
  });

  it('does not alert when the assistant simply replied', async () => {
    expect(await runChatAutoReply(binding, event())).toBe('replied');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('does not alert when the queue move failed, because nobody was handed anything', async () => {
    mocks.status.mockResolvedValue(false);
    expect(
      await runChatAutoReply(binding, event({ content: 'agent please' }))
    ).toBe('failed');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('does not alert when a person already owns the conversation', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'open', labels: [] });
    expect(
      await runChatAutoReply(binding, event({ content: 'agent please' }))
    ).toBe('skipped');
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('still tells the customer and labels the chat when the alert throws', async () => {
    mocks.alert.mockRejectedValue(new Error('database down'));
    expect(
      await runChatAutoReply(binding, event({ content: 'agent please' }))
    ).toBe('handed_over');
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.labels).toHaveBeenCalledOnce();
  });
});
