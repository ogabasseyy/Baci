import { describe, expect, it } from 'vitest';
import {
  CHAT_LABEL_AI,
  CHAT_LABEL_MERCHANT,
  mergeChatLabels,
} from './chat-auto-reply-labels';

describe('mergeChatLabels', () => {
  it('keeps unrelated labels the store added itself', () => {
    expect(mergeChatLabels(['vip'], { add: [CHAT_LABEL_AI] })).toEqual([
      'vip',
      CHAT_LABEL_AI,
    ]);
  });

  it('swaps the assistant label for the merchant label', () => {
    expect(
      mergeChatLabels(['vip', CHAT_LABEL_AI], {
        add: [CHAT_LABEL_MERCHANT],
        remove: [CHAT_LABEL_AI],
      })
    ).toEqual(['vip', CHAT_LABEL_MERCHANT]);
  });

  it('does not duplicate a label that is already there', () => {
    expect(mergeChatLabels([CHAT_LABEL_AI], { add: [CHAT_LABEL_AI] })).toEqual([
      CHAT_LABEL_AI,
    ]);
  });
});
