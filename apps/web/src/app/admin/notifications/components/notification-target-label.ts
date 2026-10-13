import type { NotificationWithStats } from '@/types/notifications';

type NotificationTarget = Pick<
  NotificationWithStats,
  'target_merchant_ids' | 'target_segment' | 'target_type'
>;

export function getNotificationTargetLabel(notification: NotificationTarget) {
  if (notification.target_type === 'all') return 'All Merchants';
  if (notification.target_type === 'specific')
    return notification.target_merchant_ids?.length
      ? `${notification.target_merchant_ids.length} Merchants`
      : 'Specific merchants';
  return `Segment: ${notification.target_segment}`;
}
