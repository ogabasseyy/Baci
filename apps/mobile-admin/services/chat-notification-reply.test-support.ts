import { CHAT_REPLY_ACTION_ID } from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';
import { vi } from 'vitest';
import { claimChatReply, firstSightThisLaunch } from './chat-reply-claims';

export const STORE = '11111111-1111-4111-8111-111111111111';

let counter = 0;

/** A notification response carrying what was typed in the Reply box. */
export function reply(
  userText: string | undefined,
  data: Record<string, unknown> = {
    type: 'customer_message',
    conversation_id: 21,
    merchant_id: STORE,
  },
  actionIdentifier = CHAT_REPLY_ACTION_ID
): NotificationResponse {
  counter += 1;
  return {
    actionIdentifier,
    userText,
    notification: {
      date: 1_700_000_000 + counter,
      request: { identifier: `n-${counter}`, content: { data } },
    },
  } as unknown as NotificationResponse;
}

/** A router, and handler dependencies with the real claims over a fake store. */
export function setup(send: (...args: never[]) => unknown) {
  const router = { push: vi.fn() };
  const deps = {
    alert: vi.fn(),
    claim: claimChatReply,
    firstSight: firstSightThisLaunch,
    invalidate: vi.fn(),
    forget: vi.fn(),
    send: send as never,
  };
  return { router, deps };
}

/** The buttons of the first alert, with their labels and actions. */
export function alertButtons(alert: ReturnType<typeof vi.fn>) {
  return alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
}
