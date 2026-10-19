import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import './use-notifications.test-support';
import { renderNotificationsHook } from './use-notifications.test-render';
import { resetNotificationHookMocks } from './use-notifications.test-support';
import { useNotifications } from './use-notifications-hook';

beforeEach(resetNotificationHookMocks);

describe('useNotifications', () => {
  it('reads notification context from the provider', () => {
    const { result } = renderNotificationsHook(() => useNotifications());

    expect(result.current.notifications).toEqual([]);
  });

  it('throws when rendered without the provider', () => {
    expect(() => renderHook(() => useNotifications())).toThrow(
      'useNotifications must be used within NotificationsProvider'
    );
  });
});
