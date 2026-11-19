import { describe, expect, it } from 'vitest';
import {
  CHAT_AUTO_REPLY_MAX_LENGTH,
  chatAutoReplySchema,
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
});
