'use client';

import { useContext } from 'react';
import NotificationsContext from './notifications-context';
import type { UseNotificationsReturn } from './use-notifications-state';

export function useNotifications(): UseNotificationsReturn {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error(
      'useNotifications must be used within NotificationsProvider'
    );
  }
  return context;
}
