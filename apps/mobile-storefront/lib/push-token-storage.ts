import { asyncStorage as AsyncStorage } from '@/lib/storage';

export const PUSH_TOKEN_STORAGE_KEY = '@baci_storefront_push_token';

// Per-user key — prevents user A's opt-out silencing user B on a shared device
export const pushOptOutKey = (userId: string) =>
  `@baci_storefront_push_opt_out_${userId}`;

// Per-user/merchant receipt of a server-confirmed push registration. A
// locally stored token is not proof: it is persisted before the server
// save, so a failed token RPC leaves a token with no server delivery.
// Readers treat a missing receipt as "remote delivery unconfirmed" and
// keep local reminders scheduled.
export const pushRegisteredKey = (userId: string, merchantId: string) =>
  `@baci_storefront_push_registered_${userId}_${merchantId}`;

// All helpers are fail-open: reads return null/false on error, writes swallow errors.
// A storage failure must never abort a sign-out or settings flow.

export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function storeLocalPushToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Fail-open: local persistence is best-effort
  }
}

export async function clearStoredPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Fail-open
  }
}

export async function isPushOptedOut(userId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(pushOptOutKey(userId));
    return val === 'true';
  } catch {
    return false;
  }
}

export async function setPushOptOut(
  userId: string,
  optOut: boolean
): Promise<void> {
  try {
    if (optOut) {
      await AsyncStorage.setItem(pushOptOutKey(userId), 'true');
    } else {
      await AsyncStorage.removeItem(pushOptOutKey(userId));
    }
  } catch {
    // Fail-open
  }
}

export async function getRegisteredPushToken(
  userId: string,
  merchantId: string
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(pushRegisteredKey(userId, merchantId));
  } catch {
    return null;
  }
}

export async function setRegisteredPushToken(
  userId: string,
  merchantId: string,
  token: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      pushRegisteredKey(userId, merchantId),
      token
    );
  } catch {
    // Fail-open: the server save already succeeded; a missing receipt
    // only keeps (duplicate) local reminders scheduled.
  }
}

export async function clearRegisteredPushToken(
  userId: string,
  merchantId: string
): Promise<void> {
  try {
    await AsyncStorage.removeItem(pushRegisteredKey(userId, merchantId));
  } catch {
    // Fail-open
  }
}
