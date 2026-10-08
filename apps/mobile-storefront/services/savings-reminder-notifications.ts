import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { useAuthStore } from '@/stores/auth-store';
import {
  ensureSavingsReminderChannel,
  ensureSavingsReminderPermissions,
  loadNotificationsModule,
} from './savings-reminder-native';
import {
  cancelStoredSavingsReminderNotification,
  disposeUnscopedSavingsReminders,
  type SavingsReminderFrequency,
  scheduleRecurringSavingsReminder,
  suppressStoredSavingsReminderNotification,
} from './savings-reminder-scheduling';
import {
  type SavingsReminderRequest,
  type SavingsReminderScope,
  savingsReminderStorage,
} from './savings-reminder-storage';

export { activateDueSavingsReminderNotification } from './savings-reminder-activation';
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

function hasServerSavingsNotificationCapabilityFor(scope: {
  merchantId: string;
  userId: string;
}) {
  return savingsNotificationCapability.isAvailable({
    apiOrigin: EXPO_PUBLIC_API_URL,
    merchantId: scope.merchantId,
    userId: scope.userId,
  });
}

export function cancelSavingsReminderNotification(
  goalId?: string,
  captured?: { merchantId: string; userId: string }
) {
  return savingsReminderStorage.runExclusive(async () => {
    // A captured scope pins delayed/queued cancellations to the account
    // that scheduled them; without it, resolveReminderScope() would read
    // the then-current auth state and could target a later sign-in.
    const scope = captured
      ? buildReminderScope(captured.userId, captured.merchantId)
      : resolveReminderScope();
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
      // Clear the stored ID only after the OS confirms cancellation. If
      // the native call throws (or the module is unavailable) the
      // recurring notification is still live, so retain the ID for a later
      // retry — otherwise it fires under the next account and sign-back-in
      // re-arms a duplicate from the retained pending request.
      if (!notifications) continue;
      try {
        await notifications.cancelScheduledNotificationAsync(
          record.notificationId
        );
      } catch (error) {
        log.debug(
          'Unable to cancel scoped savings reminder notification',
          error
        );
        continue;
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
  // Capture the scope before enqueueing: resolving inside the queued
  // callback would read then-current auth state, so a plan submitted by
  // customer A while another operation runs could be stored/scheduled in
  // customer B's scope after an account switch. The captured scope is
  // threaded through the capability check and the scheduling operation.
  const scope = resolveReminderScope();
  if (!scope) return Promise.resolve(null);
  return savingsReminderStorage.runExclusive(() =>
    scheduleReminder(
      {
        contributionAmount,
        frequency,
        goalId,
        goalTitle,
        scheduledAt,
      },
      scope
    )
  );
}

/**
 * Server-delivery suppression for a scope with an observed server
 * capability. Unlike cancelSavingsReminderNotification (which destroys the
 * records), this keeps the retained pending requests so local reminders
 * can be re-armed if server delivery later becomes unavailable.
 */
export function suppressSavingsReminderNotification(captured?: {
  merchantId: string;
  userId: string;
}) {
  return savingsReminderStorage.runExclusive(async () => {
    const scope = captured
      ? buildReminderScope(captured.userId, captured.merchantId)
      : resolveReminderScope();
    if (!scope) return false;
    const notifications = loadNotificationsModule();
    await disposeUnscopedSavingsReminders(notifications);
    return suppressStoredSavingsReminderNotification(notifications, scope);
  });
}

async function scheduleReminder(
  request: SavingsReminderRequest,
  scope: SavingsReminderScope
): Promise<string | null> {
  const notifications = loadNotificationsModule();
  await disposeUnscopedSavingsReminders(notifications);
  if (await hasServerSavingsNotificationCapabilityFor(scope)) {
    // Suppress, not cancel: pre-existing pendings must survive so local
    // reminders re-arm if server delivery is later lost.
    await suppressStoredSavingsReminderNotification(notifications, scope);
    // Persist the incoming request as a pending (no live schedule) so a
    // later loss of server delivery can still re-arm this goal; an update
    // overwrites the previous pending for the goal. Preserve a retained
    // live ID: when suppression's OS cancel fails, the notification is
    // still real and must stay trackable.
    const [existing] = await savingsReminderStorage.read(scope, request.goalId);
    await savingsReminderStorage.write({
      goalId: request.goalId,
      merchantId: scope.merchantId,
      notificationId: existing?.notificationId,
      pending: request,
      userId: scope.userId,
    });
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
