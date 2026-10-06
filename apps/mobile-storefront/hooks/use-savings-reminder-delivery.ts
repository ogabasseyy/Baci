import { useEffect } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { fetchSavingsNotificationInbox } from '@/services/savings-notification-inbox';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';

let capabilityMutations = Promise.resolve();
const capabilityOwners = new Map<string, Set<symbol>>();

export function useSavingsReminderDelivery(
  userId: string | null,
  merchantId: string | null,
  registered: boolean
) {
  useEffect(() => {
    if (!userId || !merchantId) return;
    let cancelled = false;
    const controller = new AbortController();
    const scope = { apiOrigin: EXPO_PUBLIC_API_URL, merchantId, userId };
    const scopeKey = JSON.stringify([
      scope.apiOrigin.trim(),
      merchantId.trim(),
      userId.trim(),
    ]);
    const owner = Symbol();
    const clearIfUnowned = async () => {
      if (!capabilityOwners.get(scopeKey)?.size)
        await savingsNotificationCapability.clearAvailable(scope);
    };
    const enqueue = (operation: () => Promise<void>) => {
      capabilityMutations = capabilityMutations
        .then(operation)
        .catch(() => undefined);
      return capabilityMutations;
    };
    async function synchronize() {
      try {
        const inbox = await fetchSavingsNotificationInbox({
          merchantId: scope.merchantId,
          signal: controller.signal,
        });
        if (cancelled) return;
        await enqueue(async () => {
          if (cancelled) return;
          if (!inbox.deliveryEnabled) {
            capabilityOwners.delete(scopeKey);
            await savingsNotificationCapability.clearAvailable(scope);
            return;
          }
          await savingsNotificationCapability.markAvailable(scope);
          if (cancelled) return;
          const owners = capabilityOwners.get(scopeKey) ?? new Set<symbol>();
          owners.add(owner);
          capabilityOwners.set(scopeKey, owners);
          // Pin the captured scope: this runs after a network fetch plus
          // queue delay, so resolving auth state here could target an
          // account the user switched to while it was pending.
          await cancelSavingsReminderNotification(undefined, scope);
        });
      } catch {
        return;
      }
    }
    if (registered) void synchronize();
    else void enqueue(clearIfUnowned);
    return () => {
      cancelled = true;
      controller.abort();
      const owners = capabilityOwners.get(scopeKey);
      owners?.delete(owner);
      if (owners?.size === 0) capabilityOwners.delete(scopeKey);
      if (!capabilityOwners.get(scopeKey)?.size) void enqueue(clearIfUnowned);
    };
  }, [merchantId, registered, userId]);
}
