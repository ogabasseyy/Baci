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

  it('clears the merchant label when the assistant resumes a conversation', async () => {
    mocks.snapshot.mockResolvedValue({
      status: 'pending',
      labels: ['vip', 'handled-by-merchant'],
    });
    await runChatAutoReply(binding, event());
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'handled-by-ai'],
    });
  });

  it('merges against the live labels, not the webhook snapshot', async () => {
    mocks.snapshot.mockResolvedValue({
      status: 'pending',
      labels: ['vip', 'refund-risk'],
    });
    await runChatAutoReply(binding, event());
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'refund-risk', 'handled-by-ai'],
    });
  });

  it('does not talk over a person who replied while the model was working', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'open', labels: [] });
    expect(await runChatAutoReply(binding, event())).toBe('skipped');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
  });

  it('does not reply when the live conversation cannot be read', async () => {
    mocks.snapshot.mockResolvedValue(null);
    expect(await runChatAutoReply(binding, event())).toBe('skipped');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('stays quiet when the customer wrote again while the model was working', async () => {
    mocks.latest.mockResolvedValue(false);
    expect(await runChatAutoReply(binding, event())).toBe('skipped');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('does not hand over for an older message once the customer has written again', async () => {
    mocks.latest.mockResolvedValue(false);
    mocks.generate.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect(await runChatAutoReply(binding, event())).toBe('skipped');
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('hands over when the reply is rejected so the conversation is not left pending', async () => {
    mocks.post.mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await runChatAutoReply(binding, event())).toBe('handed_over');
    expect(mocks.status).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      status: 'open',
    });
  });

  it('drops the assistant label when it hands over, so only one owner label is set', async () => {
    mocks.snapshot.mockResolvedValue({
      status: 'pending',
      labels: ['vip', 'handled-by-ai'],
    });
    await runChatAutoReply(binding, event({ content: 'agent please' }));
    expect(mocks.labels).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      labels: ['vip', 'needs-human'],
    });
  });

  it('does not overwrite a takeover that happened after the reply was sent', async () => {
    mocks.snapshot
      .mockResolvedValueOnce({ status: 'pending', labels: ['vip'] })
      .mockResolvedValue({
        status: 'open',
        labels: ['vip', 'handled-by-merchant'],
      });
    expect(await runChatAutoReply(binding, event())).toBe('replied');
    expect(mocks.labels).not.toHaveBeenCalled();
  });

  it('hands an attachment-only message to a person instead of waiting silently', async () => {
    const photo = event({ content: '', attachments: [{ file_type: 'image' }] });
    expect(await runChatAutoReply(binding, photo)).toBe('handed_over');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenCalledOnce();
  });

  it('cuts a very long customer message before it reaches the model', async () => {
    await runChatAutoReply(binding, event({ content: 'x'.repeat(50_000) }));
    expect(mocks.generate.mock.calls[0][0].question).toHaveLength(2000);
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

  it('does not tell the customer a person is coming when the queue move fails', async () => {
    mocks.status.mockResolvedValue(false);
    expect(
      await runChatAutoReply(binding, event({ content: 'agent please' }))
    ).toBe('failed');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
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
    mocks.status.mockResolvedValue(false);
    expect(await runChatAutoReply(binding, event())).toBe('failed');
    expect(mocks.labels).not.toHaveBeenCalled();
  });
});
