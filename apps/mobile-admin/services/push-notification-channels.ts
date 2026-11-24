import type * as NotificationsType from 'expo-notifications';

export async function setupAndroidChannels(
  notifications: typeof NotificationsType | null
): Promise<void> {
  if (!notifications) return;

  await notifications.setNotificationChannelAsync('orders', {
    description: 'Notifications when you receive new orders',
    importance: notifications.AndroidImportance?.HIGH || 4,
    lightColor: '#10B981',
    name: 'New Orders',
    vibrationPattern: [0, 250, 250, 250],
  });

  await notifications.setNotificationChannelAsync('payments', {
    description: 'Payment received notifications',
    importance: notifications.AndroidImportance?.HIGH || 4,
    lightColor: '#10B981',
    name: 'Payments',
    vibrationPattern: [0, 250, 250, 250],
  });

  await notifications.setNotificationChannelAsync('stock', {
    description: 'Low stock and inventory notifications',
    importance: notifications.AndroidImportance?.DEFAULT || 3,
    lightColor: '#F59E0B',
    name: 'Stock Alerts',
    vibrationPattern: [0, 200],
  });

  await notifications.setNotificationChannelAsync('admin', {
    description: 'Messages from Baci platform',
    importance: notifications.AndroidImportance?.DEFAULT || 3,
    name: 'Platform Updates',
  });

  await notifications.setNotificationChannelAsync('general', {
    description: 'Other notifications',
    importance: notifications.AndroidImportance?.LOW || 2,
    name: 'General',
  });
}
