import { describe, expect, it } from 'vitest';
import { isCurrentChatwootBridgeTarget } from './chatwoot-bridge-target';

describe('isCurrentChatwootBridgeTarget', () => {
  it('requires the same attached iframe, conversation and merchant', () => {
    const holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    const frame = document.createElement('iframe');
    frame.id = 'chatwoot_live_chat_widget';
    holder.append(frame);
    document.body.append(holder);
    const target = frame.contentWindow!;
    const input = {
      active: true,
      frame,
      target,
      storeSlug: 'store-a',
      conversationId: 905,
      activeConversationId: 905,
      activeContextRequestId: 'context_123456',
      cartState: {
        isHydrated: true,
        merchantSlug: 'store-a',
        sharedCartEnabled: true,
      },
    };

    expect(isCurrentChatwootBridgeTarget(input)).toBe(true);
    expect(
      isCurrentChatwootBridgeTarget({ ...input, activeConversationId: 906 })
    ).toBe(false);
    expect(
      isCurrentChatwootBridgeTarget({
        ...input,
        cartState: { ...input.cartState, merchantSlug: 'store-b' },
      })
    ).toBe(false);
    holder.replaceChildren(document.createElement('iframe'));
    expect(isCurrentChatwootBridgeTarget(input)).toBe(false);
  });
});
