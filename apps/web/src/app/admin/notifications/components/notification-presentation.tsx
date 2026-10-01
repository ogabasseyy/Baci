import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import type { NotificationType } from '@/types/notifications';

const notificationTypeStyles: Record<
  NotificationType,
  { badge: string; icon: typeof Info; iconClassName: string }
> = {
  info: {
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    icon: Info,
    iconClassName: 'text-blue-500',
  },
  success: {
    badge:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    icon: CheckCircle,
    iconClassName: 'text-green-500',
  },
  warning: {
    badge:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: AlertTriangle,
    iconClassName: 'text-yellow-500',
  },
  error: {
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    icon: AlertCircle,
    iconClassName: 'text-red-500',
  },
};

export function getNotificationTypePresentation(type: NotificationType) {
  return notificationTypeStyles[type];
}
