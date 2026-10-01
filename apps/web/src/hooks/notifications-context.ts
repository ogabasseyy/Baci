'use client';

import { createContext } from 'react';
import type { UseNotificationsReturn } from './use-notifications-state';

const NotificationsContext = createContext<UseNotificationsReturn | null>(null);

export default NotificationsContext;
