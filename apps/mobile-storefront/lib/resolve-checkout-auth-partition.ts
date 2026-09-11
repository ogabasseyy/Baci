import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_AUTH_PARTITION_STORAGE_KEY } from '@/config/checkout-storage';

const GUEST_AUTH_PARTITION = 'guest';

function assertAuthPartition(value: string): void {
  if (value === GUEST_AUTH_PARTITION) return;
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(
      'Checkout recovery auth partition is invalid. Please contact support.'
    );
  }
}

export async function resolveCheckoutAuthPartition(
  checkoutGeneration: string,
  currentUserId: string | undefined
): Promise<string> {
  const existing = await AsyncStorage.getItem(
    CHECKOUT_AUTH_PARTITION_STORAGE_KEY
  );
  if (existing !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(
        'Checkout recovery data is invalid. Please contact support.'
      );
    }
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as { generation?: unknown }).generation === checkoutGeneration &&
      typeof (parsed as { userId?: unknown }).userId === 'string'
    ) {
      const userId = (parsed as { userId: string }).userId;
      assertAuthPartition(userId);
      const incoming = currentUserId ?? GUEST_AUTH_PARTITION;
      if (
        userId !== GUEST_AUTH_PARTITION &&
        incoming !== GUEST_AUTH_PARTITION &&
        incoming !== userId
      ) {
        assertAuthPartition(incoming);
        await AsyncStorage.setItem(
          CHECKOUT_AUTH_PARTITION_STORAGE_KEY,
          JSON.stringify({ generation: checkoutGeneration, userId: incoming })
        );
        return incoming;
      }
      return userId;
    }
  }

  const userId = currentUserId ?? GUEST_AUTH_PARTITION;
  assertAuthPartition(userId);
  await AsyncStorage.setItem(
    CHECKOUT_AUTH_PARTITION_STORAGE_KEY,
    JSON.stringify({ generation: checkoutGeneration, userId })
  );
  return userId;
}
