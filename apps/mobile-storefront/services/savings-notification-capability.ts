import { asyncStorage } from '@/lib/storage';

const SAVINGS_NOTIFICATION_INBOX_CAPABILITY_KEY =
  'baci:savings-notification-inbox-capability';

type SavingsNotificationCapabilityScope = {
  apiOrigin: string;
  merchantId: string;
  userId: string;
};

function getCapabilityKey(scope: SavingsNotificationCapabilityScope) {
  const apiOrigin = scope.apiOrigin.trim();
  const merchantId = scope.merchantId.trim();
  const userId = scope.userId.trim();
  if (!apiOrigin || !merchantId || !userId) return null;
  return [
    SAVINGS_NOTIFICATION_INBOX_CAPABILITY_KEY,
    encodeURIComponent(apiOrigin),
    merchantId,
    userId,
  ].join(':');
}

async function isAvailable(
  scope: SavingsNotificationCapabilityScope
): Promise<boolean> {
  const key = getCapabilityKey(scope);
  if (!key) return false;
  return (await asyncStorage.getItem(key)) === 'available';
}

async function markAvailable(
  scope: SavingsNotificationCapabilityScope
): Promise<void> {
  const key = getCapabilityKey(scope);
  if (!key) return;
  await asyncStorage.setItem(key, 'available');
}

async function clearAvailable(
  scope: SavingsNotificationCapabilityScope
): Promise<void> {
  const key = getCapabilityKey(scope);
  if (!key) return;
  await asyncStorage.removeItem(key);
}

export const savingsNotificationCapability = {
  clearAvailable,
  isAvailable,
  markAvailable,
};
