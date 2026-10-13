'use client';

import { useContext } from 'react';
import NotificationsContext from './notifications-context';
import { useMerchantSafe } from './use-merchant-client';
import type { UseNotificationsReturn } from './use-notifications-state';

export function useNotificationsSafe(): UseNotificationsReturn | null {
  const merchantContext = useMerchantSafe();
  const context = useContext(NotificationsContext);
  if (!merchantContext) {
    return null;
  }
  if (!context) {
    throw new Error(
      'useNotificationsSafe must be used within NotificationsProvider'
    );
  }
  return context;
}
