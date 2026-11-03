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
    finishChatCancellation('ogabassey', 'order-1', 'uncertain');
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

  it('releases a definite rejection without unlocking another uncertain order', () => {
    expect(startChatCancellation('ogabassey', 'order-1')).toBe(true);
    finishChatCancellation('ogabassey', 'order-1', 'uncertain');
    expect(startChatCancellation('ogabassey', 'order-2')).toBe(true);
    finishChatCancellation('ogabassey', 'order-2', 'not-applied');
    expect(chatCancellationState('ogabassey', 'order-1')).toBe('uncertain');
    expect(chatCancellationState('ogabassey', 'order-2')).toBeUndefined();
    expect(startChatCancellation('ogabassey', 'order-2')).toBe(true);
  });
});
