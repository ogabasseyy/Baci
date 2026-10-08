import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { listSavingsGoals } from '@/lib/customer-savings';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { useAuthStore } from '@/stores/auth-store';
import { retireTerminalGoalReminders } from './savings-reminder-goal-reconciliation';
import {
  ensureSavingsReminderChannel,
  hasSavingsReminderPermission,
  loadNotificationsModule,
} from './savings-reminder-native';
import {
  disposeUnscopedSavingsReminders,
  scheduleRecurringSavingsReminder,
  suppressStoredSavingsReminderNotification,
} from './savings-reminder-scheduling';
import {
  type SavingsReminderScope,
  savingsReminderStorage,
} from './savings-reminder-storage';

const log = createLogger('SavingsReminderActivation');

function resolveReminderScope(): SavingsReminderScope | null {
  const { merchantId, user } = useAuthStore.getState();
  // Lazy require: a static import would cycle (the notifications module
  // re-exports activation), so resolve through the single canonical helper
  // at call time instead of duplicating its fallback logic.
  const { buildReminderScope } =
    require('./savings-reminder-notifications') as typeof import('./savings-reminder-notifications');
  return buildReminderScope(user?.id, merchantId);
}

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

/**
 * Snapshots terminal goal IDs for reminder reconciliation. Runs outside the
 * reminder mutex so a slow network never blocks scheduling and cancellation.
 * Fail-safe: a failed lookup yields an empty set, keeping every record.
 */
async function fetchTerminalGoalIds(
  scope: SavingsReminderScope
): Promise<ReadonlySet<string>> {
  try {
    const { goals } = await listSavingsGoals({
      merchantId: scope.merchantId,
    });
    return new Set(
      goals
        .filter(
          (goal) =>
            goal.status === 'completed' ||
            goal.status === 'cancelled' ||
            goal.status === 'spent'
        )
        .map((goal) => goal.id)
    );
  } catch (error) {
    log.debug('Unable to reconcile savings reminders with goal state', error);
    return new Set();
  }
}

export function activateDueSavingsReminderNotification() {
  const scope = resolveReminderScope();
  if (!scope) return Promise.resolve(null);
  return (async () => {
    // Gate the fetch on stored records only: users with no local reminders
    // skip the goals request entirely, but retirement must still run when
    // arming is impossible (a revoked permission must not strand a live
    // notification for a finished goal). Probe failure falls back to
    // fetching; the activation fails downstream as before.
    const probe = await savingsReminderStorage.read(scope).catch(() => null);
    const terminalGoalIds =
      probe === null || probe.length
        ? await fetchTerminalGoalIds(scope)
        : new Set<string>();
    return savingsReminderStorage.runExclusive(() =>
      activateDueReminders(scope, terminalGoalIds)
    );
  })();
}

async function activateDueReminders(
  scope: SavingsReminderScope,
  terminalGoalIds: ReadonlySet<string>
) {
  const notifications = loadNotificationsModule();
  await disposeUnscopedSavingsReminders(notifications);
  // Abort on mid-fetch account change: the snapshot belongs to the old
  // account, and the auth-change effect refires activation with a fresh
  // snapshot for the new one. Continuing would arm unreconciled records.
  const current = resolveReminderScope();
  if (
    !current ||
    current.userId !== scope.userId ||
    current.merchantId !== scope.merchantId
  )
    return null;
  const records = await savingsReminderStorage.read(current);
  // Retire on every path (server-owned included): terminal goals must not
  // accumulate, and this runs before the permission gates so revoked
  // permission cannot strand a live notification for a finished goal.
  const live = await retireTerminalGoalReminders(
    notifications,
    current,
    records,
    terminalGoalIds
  );
  if (await hasServerSavingsNotificationCapability()) {
    // Suppress, not cancel: the pending requests must survive so local
    // reminders re-arm if server delivery is later lost.
    await suppressStoredSavingsReminderNotification(notifications, current);
    return null;
  }
  if (!live.length) return null;
  // Retirement still runs before arming (never backgrounded): arming first
  // would briefly give completed goals live notifications that an app kill
  // could leave behind.
  if (!notifications || !(await hasSavingsReminderPermission(notifications)))
    return null;
  await ensureSavingsReminderChannel(notifications);
  // Records already converted to a live OS notification keep their retained
  // pending request — only due requests without a live notification arm now.
  const due = live.filter(
    ({ notificationId, pending }) =>
      !notificationId && pending && pending.scheduledAt.getTime() <= Date.now()
  );
  if (!due.length) return null;
  let notificationId: string | null = null;
  let failure: unknown;
  for (const { pending } of due) {
    if (!pending) continue;
    try {
      notificationId = await scheduleRecurringSavingsReminder({
        notifications,
        request: pending,
        scope: current,
      });
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  return notificationId;
}
