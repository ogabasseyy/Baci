import { useEffect } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { fetchSavingsNotificationInbox } from '@/services/savings-notification-inbox';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';

let capabilityMutations = Promise.resolve();

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
            await savingsNotificationCapability.clearAvailable(scope);
            return;
          }
          await savingsNotificationCapability.markAvailable(scope);
          if (!cancelled) await cancelSavingsReminderNotification();
        });
      } catch {
        return;
      }
    }
    if (registered) void synchronize();
    else
      void enqueue(() => savingsNotificationCapability.clearAvailable(scope));
    return () => {
      cancelled = true;
      controller.abort();
      void enqueue(() => savingsNotificationCapability.clearAvailable(scope));
    };
  }, [merchantId, registered, userId]);
}
