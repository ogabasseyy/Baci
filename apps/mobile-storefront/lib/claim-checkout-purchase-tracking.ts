import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CheckoutTracking');

function parseTrackedOrderIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
  } catch {
    return [];
  }
}

// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// array and the last write silently drops the first claim (lost update),
// letting that event emit twice.
let claimChain: Promise<void> = Promise.resolve();

export function claimCheckoutPurchaseTracking(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  const run = claimChain.then(() => performClaim(orderId, eventName));
  // performClaim catches everything, so the chain never rejects and later
  // claims always get their turn.
  claimChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function performClaim(
  orderId: string,
  eventName: string
): Promise<boolean> {
  if (!orderId) {
    return false;
  }
  try {
    const stored = parseTrackedOrderIds(
      await AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
    );
    const claim =
      eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
    if (stored.includes(claim)) {
      return false;
    }
    await AsyncStorage.setItem(
      CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
      JSON.stringify([...stored, claim])
    );
    return true;
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return false;
  }
}
