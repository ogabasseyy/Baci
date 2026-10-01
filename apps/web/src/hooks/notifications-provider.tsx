'use client';

import type { ReactNode } from 'react';
import NotificationsContext from './notifications-context';
import { useMerchant } from './use-merchant-client';
import { useNotificationsState } from './use-notifications-state';

/** One Realtime owner for every dashboard notification surface. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { merchant } = useMerchant();
  const value = useNotificationsState(merchant);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
