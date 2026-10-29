import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatCancellationState,
  finishChatCancellation,
  reconcileChatCancellations,
  resetChatCancellationStateForTests,
  startChatCancellation,
} from './chat-cancellation-state';

beforeEach(resetChatCancellationStateForTests);

describe('shared chat cancellation state', () => {
  it('blocks a second request for the same order until terminal confirmation', () => {
    expect(startChatCancellation('ogabassey', 'order-1')).toBe(true);
    expect(startChatCancellation('ogabassey', 'order-1')).toBe(false);
    expect(startChatCancellation('another-store', 'order-1')).toBe(true);
    finishChatCancellation('ogabassey', 'order-1', false);
    reconcileChatCancellations('ogabassey', [
      { id: 'order-1', shipping_status: 'pending' },
    ]);
    expect(chatCancellationState('ogabassey', 'order-1')).toBe('uncertain');
    reconcileChatCancellations('ogabassey', [
      { id: 'order-1', shipping_status: 'cancelled' },
    ]);
    expect(chatCancellationState('ogabassey', 'order-1')).toBe('resolved');
    expect(startChatCancellation('ogabassey', 'order-1')).toBe(false);
  });
});
