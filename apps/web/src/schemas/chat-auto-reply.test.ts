import { describe, expect, it } from 'vitest';
import {
  CHAT_AUTO_REPLY_MAX_LENGTH,
  chatAutoReplySchema,
  conversationSnapshotSchema,
} from './chat-auto-reply';

describe('chatAutoReplySchema', () => {
  it('accepts a reply with a confidence', () => {
    expect(
      chatAutoReplySchema.safeParse({
        reply: ' Yes. ',
        confidence: 0.8,
        needsHuman: false,
      })
    ).toMatchObject({ success: true, data: { reply: 'Yes.' } });
  });

  it.each([
    ['confidence above 1', { reply: 'x', confidence: 1.2, needsHuman: false }],
    [
      'negative confidence',
      { reply: 'x', confidence: -0.1, needsHuman: false },
    ],
    ['missing needsHuman', { reply: 'x', confidence: 0.5 }],
    [
      'a string confidence',
      { reply: 'x', confidence: 'high', needsHuman: false },
    ],
    [
      'an over-long reply',
      {
        reply: 'x'.repeat(CHAT_AUTO_REPLY_MAX_LENGTH + 1),
        confidence: 0.5,
        needsHuman: false,
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(chatAutoReplySchema.safeParse(value).success).toBe(false);
  });

  it('keeps a known intent', () => {
    expect(
      chatAutoReplySchema.safeParse({
        reply: 'x',
        confidence: 0.8,
        needsHuman: false,
        intent: 'add_to_cart',
      })
    ).toMatchObject({ success: true, data: { intent: 'add_to_cart' } });
  });

  it('ignores an unknown intent instead of failing the whole reply', () => {
    const parsed = chatAutoReplySchema.safeParse({
      reply: 'x',
      confidence: 0.8,
      needsHuman: false,
      intent: 'greeting',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.intent).toBeUndefined();
  });
});

describe('conversationSnapshotSchema', () => {
  it('defaults missing labels to none', () => {
    expect(conversationSnapshotSchema.parse({ status: 'pending' })).toEqual({
      status: 'pending',
      labels: [],
    });
  });

  it('rejects more than 50 labels', () => {
    const labels = Array.from({ length: 51 }, (_, i) => `l${i}`);
    expect(
      conversationSnapshotSchema.safeParse({ status: 'open', labels }).success
    ).toBe(false);
    expect(
      conversationSnapshotSchema.safeParse({
        status: 'open',
        labels: labels.slice(0, 50),
      }).success
    ).toBe(true);
  });
});
