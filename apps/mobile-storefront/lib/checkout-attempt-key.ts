import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CHECKOUT_INSTALLATION_STORAGE_KEY } from '@/config/checkout-storage';
import { resolveCheckoutGeneration } from '@/lib/checkout-attempt-identity';

let installationPromise: Promise<string> | undefined;

async function loadInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(
    CHECKOUT_INSTALLATION_STORAGE_KEY
  );
  if (existing !== null) {
    if (!/^[0-9a-f-]{36}$/i.test(existing)) {
      throw new Error(
        'Checkout recovery data is invalid. Please contact support.'
      );
    }
    return existing;
  }
  const id = Crypto.randomUUID();
  // Persist before any order request. Storage failure must not create an order
  // whose key cannot be recovered after a process restart.
  await AsyncStorage.setItem(CHECKOUT_INSTALLATION_STORAGE_KEY, id);
  return id;
}

function itemSortValue(item: unknown, key: string): string | number | boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const value = (item as Record<string, unknown>)[key];
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function compareCheckoutAttemptItems(left: unknown, right: unknown): number {
  const keys = [
    'product_id',
    'variant_id',
    'variant_name',
    'condition',
    'quantity',
    'price',
    'assurance_fee',
    'has_assurance',
    'variant_attributes',
  ] as const;
  for (const key of keys) {
    const a = itemSortValue(left, key);
    const b = itemSortValue(right, key);
    if (typeof a === 'number' && typeof b === 'number' && a !== b) {
      return a - b;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean' && a !== b) {
      return a ? 1 : -1;
    }
    const compared = String(a).localeCompare(String(b));
    if (compared !== 0) return compared;
  }
  return 0;
}

function canonicalize(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return parentKey === 'items'
      ? [...items].sort(compareCheckoutAttemptItems)
      : items;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item, key)])
    );
  }
  return value;
}

/** Same cart lifecycle and exact request resume the same server-owned order. */
export async function getCheckoutAttemptKey(
  payload: Record<string, unknown>,
  checkoutGeneration: string
): Promise<string> {
  installationPromise ??= loadInstallationId().catch((error: unknown) => {
    installationPromise = undefined;
    throw error;
  });
  const installationId = await installationPromise;
  const generation = await resolveCheckoutGeneration(checkoutGeneration);
  // The server intentionally excludes the selected gateway from its checkout
  // hash so switching payment methods resumes the same pending order.
  const recoveryPayload = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => key !== 'payment_method' && key !== 'payment_status'
    )
  );
  // Only an opaque installation ID is stored here, never checkout PII. The
  // payload contains merchant/customer identity and every submitted money,
  // variant, voucher, delivery and credit field. Object key order is irrelevant.
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(
      canonicalize({
        installationId,
        checkoutGeneration: generation,
        payload: recoveryPayload,
      })
    )
  );
}
