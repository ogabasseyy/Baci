import { renderHook } from '@testing-library/react';
import './use-notifications.test-support';
import { NotificationsProvider } from './notifications-provider';

export function renderNotificationsHook<Result>(hook: () => Result) {
  return renderHook(hook, { wrapper: NotificationsProvider });
}
