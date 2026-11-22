import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/ai/chat-auto-reply', () => ({
  generateChatAutoReply: mocks.generate,
}));
vi.mock('./chat-auto-reply-history', () => ({
  loadChatAutoReplyHistory: vi.fn().mockResolvedValue([]),
  isLatestChatMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('./chat-auto-reply-client', () => ({
  postAssistantMessage: mocks.post,
  setConversationStatus: vi.fn().mockResolvedValue(true),
  setConversationLabels: vi.fn().mockResolvedValue(true),
  getConversationSnapshot: vi
    .fn()
    .mockResolvedValue({ status: 'pending', labels: [] }),
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
const event = {
  event: 'message_created' as const,
  id: 100,
  message_type: 'incoming',
  private: false,
  content: 'I wish for Demo Phone X at 90000',
  account: { id: 2 },
  inbox: { id: 20 },
  conversation: { id: 7, status: 'pending', labels: [] },
  sender: { name: 'Ada', type: 'contact' },
};
const offer = {
  productId: 'p-1',
  slug: 's',
  name: 'Demo Phone X',
  catalogPrice: 100000,
  grantedPrice: 90000,
  currency: 'NGN',
};
const reply = { reply: 'Deal!', confidence: 0.9, needsHuman: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue(true);
});

describe('runChatAutoReply with Santa offers', () => {
  it('attaches verified offers to the outgoing message', async () => {
    mocks.generate.mockResolvedValue({ ok: true, reply, santaOffers: [offer] });
    expect(await runChatAutoReply(binding, event)).toBe('replied');
    expect(mocks.post).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      content: 'Deal!',
      contentAttributes: { baci_santa_offers: [offer] },
    });
  });

  it('sends a plain message when there are no offers', async () => {
    mocks.generate.mockResolvedValue({ ok: true, reply, santaOffers: [] });
    await runChatAutoReply(binding, event);
    expect(mocks.post).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      content: 'Deal!',
    });
  });
});
