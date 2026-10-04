import { useEffect } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { fetchSavingsNotificationInbox } from '@/services/savings-notification-inbox';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';

export function useSavingsReminderDelivery(
  userId: string | null,
  merchantId: string | null,
  registered: boolean
) {
  useEffect(() => {
    if (!userId || !merchantId || !registered) return;
    let cancelled = false;
    const controller = new AbortController();
    const scope = { apiOrigin: EXPO_PUBLIC_API_URL, merchantId, userId };
    async function synchronize() {
      try {
        const inbox = await fetchSavingsNotificationInbox({
          merchantId: scope.merchantId,
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!inbox.deliveryEnabled) {
          await savingsNotificationCapability.clearAvailable(scope);
          return;
        }
        await savingsNotificationCapability.markAvailable(scope);
        if (!cancelled) await cancelSavingsReminderNotification();
      } catch {
        return;
      }
    }
    void synchronize();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [merchantId, registered, userId]);
}
