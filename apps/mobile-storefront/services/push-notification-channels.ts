import { createLogger } from '@/lib/logger';

const log = createLogger('PushNotificationChannels');

/**
 * Idempotent create-or-update of the Android notification channels. Called by
 * full registration AND directly on app startup, because a stored push token
 * short-circuits full registration — otherwise installs that registered before
 * a new channel was introduced (e.g. `payments`) would never create it and
 * Android 8+ could drop notifications sent to it.
 *
 * No Platform gate here (platform-drift budget): callers guard on Android,
 * and `setNotificationChannelAsync` is a documented no-op off Android anyway.
 */
export async function ensureAndroidNotificationChannels(): Promise<void> {
  let Notifications: typeof import('expo-notifications') | null = null;
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    log.debug('expo-notifications unavailable; skipping channel setup:', e);
    return;
  }
  if (!Notifications) return;

  const channels = [
    {
      id: 'orders',
      config: {
        name: 'Order Updates',
        description: 'Notifications about your order status',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#DC2626',
      },
    },
    {
      id: 'payments',
      config: {
        name: 'Payments',
        description: 'Wallet credits and payment updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#DC2626',
      },
    },
    {
      // The savings push worker addresses this channel id explicitly, and
      // Android drops pushes naming a channel that was never created. It
      // must exist from shared setup (which runs before token issue and on
      // startup), not only from local-reminder scheduling, which is
      // skipped once server delivery is available.
      id: 'savings',
      config: {
        name: 'Savings',
        description: 'Savings goal reminders and payout updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#16A34A',
      },
    },
    {
      id: 'promotions',
      config: {
        name: 'Deals & Promotions',
        description: 'Special offers and discounts',
        importance: Notifications.AndroidImportance.DEFAULT,
      },
    },
    {
      id: 'general',
      config: {
        name: 'General',
        description: 'General notifications',
        importance: Notifications.AndroidImportance.DEFAULT,
      },
    },
  ];

  const results = await Promise.allSettled(
    channels.map(({ config, id }) =>
      Notifications.setNotificationChannelAsync(id, config)
    )
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      log.warn('Android notification channel registration failed.', {
        channel: channels[index]?.id,
        error: result.reason,
      });
    }
  });
}
