import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  history: vi.fn(),
  latest: vi.fn(),
  post: vi.fn(),
  status: vi.fn(),
  labels: vi.fn(),
  snapshot: vi.fn(),
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

import { recordMerchantTakeover } from './chat-auto-reply';

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

  it('reports failure when the queue move fails, so the assistant is not left running', async () => {
    mocks.status.mockResolvedValue(false);
    expect(await recordMerchantTakeover(binding, staff('pending'))).toBe(
      'failed'
    );
    expect(mocks.labels).toHaveBeenCalledOnce();
  });

  it('does not reopen a conversation staff resolved after replying', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'resolved', labels: ['vip'] });
    expect(await recordMerchantTakeover(binding, staff('pending'))).toBe(
      'replied'
    );
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('reports failure, without moving the queue, when the live status cannot be read', async () => {
    mocks.snapshot.mockResolvedValue(null);
    expect(await recordMerchantTakeover(binding, staff('pending'))).toBe(
      'failed'
    );
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('moves a still-pending conversation even when the event carries no status', async () => {
    const noStatus = event({
      message_type: 'outgoing',
      sender: { name: 'Staff', type: 'user' },
      conversation: { id: 7, labels: [] },
    });
    expect(await recordMerchantTakeover(binding, noStatus)).toBe('replied');
    expect(mocks.status).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      status: 'open',
    });
  });

  it('only relabels a conversation that is already open', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'open', labels: ['vip'] });
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
