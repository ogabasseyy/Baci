import { beforeEach, describe, expect, it } from 'vitest';
import './use-notifications.test-support';
import { useNotifications } from './use-notifications';
import { renderNotificationsHook } from './use-notifications.test-render';
import { resetNotificationHookMocks } from './use-notifications.test-support';

beforeEach(resetNotificationHookMocks);

describe('renderNotificationsHook', () => {
  it('provides notification context without throwing', () => {
    const { result } = renderNotificationsHook(() => useNotifications());

    expect(result.current.notifications).toEqual([]);
  });
});
