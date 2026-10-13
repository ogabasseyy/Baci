import { getCustomerSavingsApiClient } from '@/lib/customer-savings-api';
import {
  SavingsNotificationIdentifierSchema,
  SavingsNotificationInboxResponseSchema,
  SavingsNotificationMerchantInputSchema,
  SavingsNotificationMutationResponseSchema,
  type SavingsNotificationPreferencesPatch,
  SavingsNotificationPreferencesPatchSchema,
} from '@/schemas/savings-notifications';

const SAVINGS_NOTIFICATIONS_PATH =
  '/api/storefront/customer/savings/notifications';

export async function fetchSavingsNotificationInbox(input: {
  merchantId: string;
  signal?: AbortSignal;
}) {
  const { merchantId } = SavingsNotificationMerchantInputSchema.parse(input);
  const data = await getCustomerSavingsApiClient().fetchJson({
    path: SAVINGS_NOTIFICATIONS_PATH,
    query: { merchantId },
    signal: input.signal,
  });
  return SavingsNotificationInboxResponseSchema.parse(data);
}

export async function markSavingsNotificationRead(input: {
  merchantId: string;
  notificationId: string;
}) {
  const { merchantId } = SavingsNotificationMerchantInputSchema.parse(input);
  const data = await getCustomerSavingsApiClient().fetchJson({
    body: {
      merchantId,
      readNotificationId: SavingsNotificationIdentifierSchema.parse(
        input.notificationId
      ),
    },
    method: 'PATCH',
    path: SAVINGS_NOTIFICATIONS_PATH,
  });
  return SavingsNotificationMutationResponseSchema.parse(data);
}

export async function updateSavingsNotificationPreferences(input: {
  merchantId: string;
  preferences: SavingsNotificationPreferencesPatch;
}) {
  const { merchantId } = SavingsNotificationMerchantInputSchema.parse(input);
  const preferences = SavingsNotificationPreferencesPatchSchema.parse(
    input.preferences
  );
  const data = await getCustomerSavingsApiClient().fetchJson({
    body: { merchantId, preferences },
    method: 'PATCH',
    path: SAVINGS_NOTIFICATIONS_PATH,
  });
  return SavingsNotificationMutationResponseSchema.parse(data);
}
