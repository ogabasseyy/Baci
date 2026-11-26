import { CHAT_REPLY_ACTION_ID } from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';
import { describe, expect, it } from 'vitest';
import { isChatReplyResponse } from './chat-reply-response';

const response = (actionIdentifier: string) =>
  ({ actionIdentifier }) as unknown as NotificationResponse;

describe('isChatReplyResponse', () => {
  it('is true for the Reply action', () => {
    expect(isChatReplyResponse(response(CHAT_REPLY_ACTION_ID))).toBe(true);
  });

  it('is false for a plain tap and for any other action', () => {
    expect(
      isChatReplyResponse(
        response('expo.modules.notifications.actions.DEFAULT')
      )
    ).toBe(false);
    expect(isChatReplyResponse(response('reply'))).toBe(false);
  });
});
