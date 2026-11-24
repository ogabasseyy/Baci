import type { NotificationResponse } from 'expo-notifications';
import { describe, expect, it, vi } from 'vitest';
import {
  handleNotificationTap,
  navigateToNotificationTarget,
} from './push-notification-navigation';

const replyMocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('@/services/chat-notification-reply', () => ({
  handleChatReplyResponse: replyMocks.handle,
  isChatReplyResponse: (response: { actionIdentifier?: string }) =>
    response.actionIdentifier === 'chat_reply_send',
}));

vi.mock('@/services/push-notifications', () => ({
  getNotificationNavigationParams: (response: NotificationResponse) => {
    const data = response.notification.request.content.data as Record<
      string,
      unknown
    >;
    if (data?.screen === 'order') {
      return { params: { id: String(data.id) }, screen: 'order' };
    }
    return null;
  },
}));

function makeResponse(
  data: unknown,
  actionIdentifier = 'expo.modules.notifications.actions.DEFAULT'
): NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      request: {
        content: { data },
      },
    },
  } as unknown as NotificationResponse;
}

describe('navigateToNotificationTarget', () => {
  it('routes entity notifications with encoded ids', () => {
    const router = { push: vi.fn() };

    navigateToNotificationTarget(router, {
      params: { id: 'order 123' },
      screen: 'order',
    });
    navigateToNotificationTarget(router, {
      params: { id: 'phone/sku' },
      screen: 'product',
    });

    expect(router.push).toHaveBeenNthCalledWith(
      1,
      '/(admin)/order/order%20123'
    );
    expect(router.push).toHaveBeenNthCalledWith(
      2,
      '/(admin)/product/phone%2Fsku'
    );
  });

  it('routes aggregate and unknown notifications to safe fallbacks', () => {
    const router = { push: vi.fn() };

    navigateToNotificationTarget(router, { screen: 'orders' });
    navigateToNotificationTarget(router, { screen: 'unknown' });
    navigateToNotificationTarget(router, null);

    expect(router.push).toHaveBeenNthCalledWith(1, '/(admin)/(tabs)/orders');
    expect(router.push).toHaveBeenNthCalledWith(2, '/(admin)/(tabs)');
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it('routes negotiation notifications to the list screen (no detail route exists)', () => {
    const router = { push: vi.fn() };

    // A negotiation push carries an id, but there is no `negotiations/[id]`
    // screen — routing to it throws "Unmatched Route". Both the id and no-id
    // cases must land on the list screen.
    navigateToNotificationTarget(router, {
      params: { id: 'abc-123' },
      screen: 'negotiation',
    });
    navigateToNotificationTarget(router, { screen: 'negotiations' });

    expect(router.push).toHaveBeenNthCalledWith(1, '/(admin)/negotiations');
    expect(router.push).toHaveBeenNthCalledWith(2, '/(admin)/negotiations');
  });

  it('routes repair notifications with an id to the booking detail screen', () => {
    const router = { push: vi.fn() };

    navigateToNotificationTarget(router, {
      params: { id: 'repair 123' },
      screen: 'repair',
    });

    expect(router.push).toHaveBeenCalledWith('/(admin)/repairs/repair%20123');
  });

  it('routes repair notifications without an id to the bookings list screen', () => {
    const router = { push: vi.fn() };

    navigateToNotificationTarget(router, { screen: 'repair' });
    navigateToNotificationTarget(router, { screen: 'repairs' });

    expect(router.push).toHaveBeenNthCalledWith(1, '/(admin)/repairs');
    expect(router.push).toHaveBeenNthCalledWith(2, '/(admin)/repairs');
  });
});

describe('handleNotificationTap', () => {
  it('requests an update check and does not navigate for mobile_update_available taps', () => {
    const router = { push: vi.fn() };
    const requestUpdateCheck = vi.fn();

    handleNotificationTap(
      router,
      makeResponse({ type: 'mobile_update_available' }),
      requestUpdateCheck
    );

    expect(requestUpdateCheck).toHaveBeenCalledWith('push-notification');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('navigates to the notification target for non-update notifications', () => {
    const router = { push: vi.fn() };
    const requestUpdateCheck = vi.fn();

    handleNotificationTap(
      router,
      makeResponse({ screen: 'order', id: '42' }),
      requestUpdateCheck
    );

    expect(requestUpdateCheck).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/order/42');
  });

  it.each([
    null,
    'order',
    ['order'],
    42,
    new Date('2026-06-28'),
  ])('ignores invalid notification data: %s', (data) => {
    const router = { push: vi.fn() };
    const requestUpdateCheck = vi.fn();

    handleNotificationTap(router, makeResponse(data), requestUpdateCheck);

    expect(requestUpdateCheck).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('routes customer message notifications to the conversation thread', () => {
    const router = { push: vi.fn() };

    navigateToNotificationTarget(router, {
      params: { id: '4821' },
      screen: 'message',
    });
    navigateToNotificationTarget(router, { screen: 'messages' });

    expect(router.push).toHaveBeenNthCalledWith(1, '/(admin)/messages/4821');
    expect(router.push).toHaveBeenNthCalledWith(2, '/(admin)/messages');
  });

  it('bugfix: hands the Reply box of a chat notification to the reply sender instead of only opening the chat', () => {
    replyMocks.handle.mockClear();
    const router = { push: vi.fn() };
    const response = makeResponse(
      { type: 'customer_message', conversation_id: 4821 },
      'chat_reply_send'
    );

    handleNotificationTap(router, response, vi.fn());

    expect(replyMocks.handle).toHaveBeenCalledWith(router, response);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('still just opens the chat for a plain tap on a chat notification', () => {
    replyMocks.handle.mockClear();
    const router = { push: vi.fn() };

    handleNotificationTap(
      router,
      makeResponse({ screen: 'order', id: '7' }),
      vi.fn()
    );

    expect(replyMocks.handle).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/(admin)/order/7');
  });
});
