import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import './use-notifications.test-support';
import { renderNotificationsHook } from './use-notifications.test-render';
import {
  resetNotificationHookMocks,
  setSafeMerchant,
} from './use-notifications.test-support';
import { useNotificationsSafe } from './use-notifications-safe';

beforeEach(resetNotificationHookMocks);

describe('useNotificationsSafe', () => {
  it('returns notification context for an available merchant', () => {
    const { result } = renderNotificationsHook(() => useNotificationsSafe());

    expect(result.current?.notifications).toEqual([]);
  });

  it('returns null when merchant context is absent', () => {
    setSafeMerchant(null);

    const { result } = renderHook(() => useNotificationsSafe());

    expect(result.current).toBeNull();
  });
});
