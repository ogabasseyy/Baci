import { Platform } from 'react-native';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { useAuthStore } from '@/stores/auth-store';
import {
  type SavingsReminderRequest,
  type SavingsReminderScope,
  savingsReminderStorage,
} from './savings-reminder-storage';

export type { SavingsReminderScope };

/**
 * Builds the storage scope for reminder records. Pure over explicit inputs
 * so the auth-change cleanup (which must target the PREVIOUS scope) resolves
 * identically to the live paths. Returns null when no account qualifies —
 * callers fail closed rather than read or write device-global state.
 */
export function buildReminderScope(
  userId: string | null | undefined,
  merchantId: string | null | undefined
): SavingsReminderScope | null {
  const resolvedMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!userId || !resolvedMerchantId) return null;
  return { merchantId: resolvedMerchantId, userId };
}

function resolveReminderScope(): SavingsReminderScope | null {
  const { merchantId, user } = useAuthStore.getState();
  return buildReminderScope(user?.id, merchantId);
}

const log = createLogger('SavingsReminderNotifications');
const SAVINGS_REMINDER_CHANNEL_ID = 'savings';
type SavingsReminderFrequency = 'daily' | 'weekly' | 'monthly';
type NotificationsModule = typeof import('expo-notifications');

let Notifications: NotificationsModule | null = null;

function hasServerSavingsNotificationCapability() {
  const { merchantId, user } = useAuthStore.getState();
  const resolvedMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!resolvedMerchantId || !user?.id) return Promise.resolve(false);
  return savingsNotificationCapability.isAvailable({
    apiOrigin: EXPO_PUBLIC_API_URL,
    merchantId: resolvedMerchantId,
    userId: user.id,
  });
}

function loadNotificationsModule() {
  if (Platform.OS === 'web') return null;
  if (Notifications) return Notifications;
  try {
    Notifications = require('expo-notifications') as NotificationsModule;
    return Notifications;
  } catch (error) {
    log.debug('Notifications module unavailable for savings reminders', error);
    return null;
  }
}

async function ensureSavingsReminderPermissions(
  notifications: NotificationsModule
) {
  const { status: existingStatus } = await notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function hasSavingsReminderPermission(
  notifications: NotificationsModule
) {
  const { status } = await notifications.getPermissionsAsync();
  return status === 'granted';
}

async function ensureSavingsReminderChannel(
  notifications: NotificationsModule
) {
  if (Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(SAVINGS_REMINDER_CHANNEL_ID, {
    name: 'Savings Reminders',
    description: 'Reminders to keep your device savings goal on track',
    importance: notifications.AndroidImportance.DEFAULT,
  });
}

function buildSavingsReminderTrigger({
  frequency,
  notifications,
  scheduledAt,
}: {
  frequency: SavingsReminderFrequency;
  notifications: NotificationsModule;
  scheduledAt: Date;
}) {
  const shared = {
    channelId: SAVINGS_REMINDER_CHANNEL_ID,
    hour: scheduledAt.getHours(),
    minute: scheduledAt.getMinutes(),
  };
  if (frequency === 'daily') {
    return {
      ...shared,
      type: notifications.SchedulableTriggerInputTypes.DAILY,
    };
  }
  if (frequency === 'weekly') {
    return {
      ...shared,
      type: notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: scheduledAt.getDay() + 1,
    };
  }
  return {
    ...shared,
    day: scheduledAt.getDate(),
    type: notifications.SchedulableTriggerInputTypes.MONTHLY,
  };
}

async function cancelStoredSavingsReminderNotification(
  notifications: NotificationsModule | null,
  scope: SavingsReminderScope,
  goalId?: string
) {
  let removed = false;
  for (const record of await savingsReminderStorage.read(scope, goalId)) {
    if (record.notificationId) {
      if (!notifications) {
        await savingsReminderStorage.write({ ...record, pending: undefined });
        removed ||= Boolean(record.pending);
        continue;
      }
      try {
        await notifications.cancelScheduledNotificationAsync(
          record.notificationId
        );
      } catch (error) {
        log.debug(
          'Unable to cancel stored savings reminder notification',
          error
        );
        await savingsReminderStorage.write({ ...record, pending: undefined });
        removed ||= Boolean(record.pending);
        continue;
      }
    }
    removed ||= Boolean(record.notificationId || record.pending);
    await savingsReminderStorage.remove(scope, record.goalId);
  }
  return removed;
}

/**
 * One-way disposal of pre-scope records. Unscoped state cannot be attributed
 * to the current account, so any live OS notification is cancelled and the
 * record dropped — never adopted. Runs at every entry point (idempotent).
 */
async function disposeUnscopedSavingsReminders(
  notifications: NotificationsModule | null
) {
  for (const record of await savingsReminderStorage.drainUnscoped()) {
    if (!record.notificationId || !notifications) continue;
    try {
      await notifications.cancelScheduledNotificationAsync(
        record.notificationId
      );
    } catch (error) {
      log.debug(
        'Unable to cancel unscoped savings reminder notification',
        error
      );
    }
  }
}

async function scheduleRecurringSavingsReminder({
  notifications,
  request,
  scope,
}: {
  notifications: NotificationsModule;
  request: SavingsReminderRequest;
  scope: SavingsReminderScope;
}) {
  const notificationId = await notifications.scheduleNotificationAsync({
    content: {
      title: 'Savings reminder',
      body: `Add ${formatNgnCurrency(request.contributionAmount)} toward ${request.goalTitle}.`,
      data: {
        goalId: request.goalId,
        screen: 'wallet',
        type: 'customer_savings_reminder',
      },
    },
    trigger: buildSavingsReminderTrigger({
      frequency: request.frequency,
      notifications,
      scheduledAt: request.scheduledAt,
    }),
  });
  // The pending request is retained after scheduling so auth-change cleanup
  // can re-arm the record (clear the cancelled notificationId, keep pending)
  // instead of silently destroying the reminder on sign-out.
  await savingsReminderStorage.write({
    goalId: request.goalId,
    merchantId: scope.merchantId,
    notificationId,
    pending: request,
    userId: scope.userId,
  });
  return notificationId;
}

export function cancelSavingsReminderNotification(goalId?: string) {
  return savingsReminderStorage.runExclusive(async () => {
    const scope = resolveReminderScope();
    if (!scope) return false;
    const notifications = loadNotificationsModule();
    await disposeUnscopedSavingsReminders(notifications);
    return cancelStoredSavingsReminderNotification(
      notifications,
      scope,
      goalId
    );
  });
}

/**
 * Auth-change cleanup for a scope that is no longer active. Cancels the
 * prior scope's live OS notifications and re-arms the records (clears the
 * cancelled notificationId, keeps the retained pending request) so the
 * reminders resume if the account signs back in — instead of firing under
 * a different account or dying silently.
 */
export function cancelScopeSavingsReminders(scope: SavingsReminderScope) {
  return savingsReminderStorage.runExclusive(async () => {
    const notifications = loadNotificationsModule();
    await disposeUnscopedSavingsReminders(notifications);
    let cancelled = false;
    for (const record of await savingsReminderStorage.read(scope)) {
      if (!record.notificationId) continue;
      if (notifications) {
        try {
          await notifications.cancelScheduledNotificationAsync(
            record.notificationId
          );
        } catch (error) {
          log.debug(
            'Unable to cancel scoped savings reminder notification',
            error
          );
        }
      }
      await savingsReminderStorage.write({
        ...record,
        notificationId: undefined,
      });
      cancelled = true;
    }
    return cancelled;
  });
}

export function activateDueSavingsReminderNotification() {
  return savingsReminderStorage.runExclusive(activateDueReminders);
}

async function activateDueReminders() {
  const scope = resolveReminderScope();
  if (!scope) return null;
  const notifications = loadNotificationsModule();
  await disposeUnscopedSavingsReminders(notifications);
  if (await hasServerSavingsNotificationCapability()) {
    await cancelStoredSavingsReminderNotification(notifications, scope);
    return null;
  }
  const records = await savingsReminderStorage.read(scope);
  // Records already converted to a live OS notification keep their retained
  // pending request — only due requests without a live notification arm now.
  const due = records.filter(
    ({ notificationId, pending }) =>
      !notificationId && pending && pending.scheduledAt.getTime() <= Date.now()
  );
  if (!due.length) return null;
  if (!notifications || !(await hasSavingsReminderPermission(notifications)))
    return null;
  await ensureSavingsReminderChannel(notifications);
  let notificationId: string | null = null;
  let failure: unknown;
  for (const { pending } of due) {
    if (!pending) continue;
    try {
      notificationId = await scheduleRecurringSavingsReminder({
        notifications,
        request: pending,
        scope,
      });
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  return notificationId;
}

export function scheduleSavingsReminderNotification({
  contributionAmount,
  frequency,
  goalId,
  goalTitle,
  scheduledAt = new Date(),
}: {
  contributionAmount: number;
  frequency: SavingsReminderFrequency;
  goalId: string;
  goalTitle: string;
  scheduledAt?: Date;
}): Promise<string | null> {
  return savingsReminderStorage.runExclusive(() =>
    scheduleReminder({
      contributionAmount,
      frequency,
      goalId,
      goalTitle,
      scheduledAt,
    })
  );
}

async function scheduleReminder(
  request: SavingsReminderRequest
): Promise<string | null> {
  const scope = resolveReminderScope();
  if (!scope) return null;
  const notifications = loadNotificationsModule();
  await disposeUnscopedSavingsReminders(notifications);
  if (await hasServerSavingsNotificationCapability()) {
    await cancelStoredSavingsReminderNotification(notifications, scope);
    return null;
  }
  if (
    !notifications ||
    !(await ensureSavingsReminderPermissions(notifications))
  )
    return null;
  await ensureSavingsReminderChannel(notifications);
  await cancelStoredSavingsReminderNotification(
    notifications,
    scope,
    request.goalId
  );
  const [remaining] = await savingsReminderStorage.read(scope, request.goalId);
  if (remaining.notificationId) return null;
  if (request.scheduledAt.getTime() > Date.now()) {
    await savingsReminderStorage.write({
      goalId: request.goalId,
      merchantId: scope.merchantId,
      pending: request,
      userId: scope.userId,
    });
    return null;
  }
  return await scheduleRecurringSavingsReminder({
    notifications,
    request,
    scope,
  });
}
