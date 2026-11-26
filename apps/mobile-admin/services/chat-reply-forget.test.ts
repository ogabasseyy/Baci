import { CHAT_REPLY_ACTION_ID } from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  last: null as unknown,
  getLastNotificationResponse: vi.fn(),
  clearLastNotificationResponse: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  getLastNotificationResponse: native.getLastNotificationResponse,
  clearLastNotificationResponse: native.clearLastNotificationResponse,
}));

import { forgetChatReplyResponse } from './chat-reply-forget';

function reply(id: string, text = 'Hello'): NotificationResponse {
  return {
    actionIdentifier: CHAT_REPLY_ACTION_ID,
    userText: text,
    notification: { request: { identifier: id, content: { data: {} } } },
  } as unknown as NotificationResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  native.last = null;
  native.getLastNotificationResponse.mockImplementation(() => native.last);
  native.clearLastNotificationResponse.mockImplementation(() => {
    native.last = null;
  });
});

describe('forgetChatReplyResponse', () => {
  it('bugfix: the next start reads nothing once the reply has been dealt with', async () => {
    native.last = reply('n-1');

    await forgetChatReplyResponse(reply('n-1'));

    expect(native.getLastNotificationResponse()).toBeNull();
  });

  it.each([
    ['another notification', reply('n-2')],
    ['another reply to the same notification', reply('n-1', 'Different')],
    [
      'a plain tap on the same notification',
      {
        ...reply('n-1'),
        actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      },
    ],
  ])('leaves a newer response alone: %s', async (_name, newer) => {
    native.last = newer;

    await forgetChatReplyResponse(reply('n-1'));

    expect(native.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('does nothing when there is no last response', async () => {
    await forgetChatReplyResponse(reply('n-1'));

    expect(native.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('never rejects when the device cannot be asked', async () => {
    native.getLastNotificationResponse.mockImplementation(() => {
      throw new Error('unavailable');
    });

    await expect(
      forgetChatReplyResponse(reply('n-1'))
    ).resolves.toBeUndefined();
  });
});
