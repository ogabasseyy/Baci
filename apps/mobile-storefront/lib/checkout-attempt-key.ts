import {
  buildOrderIdempotencyPayload,
  type OrderIdempotencyPayloadInput,
} from '@baci/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CHECKOUT_INSTALLATION_STORAGE_KEY } from '@/config/checkout-storage';
import { applyCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { resolveCheckoutGeneration } from '@/lib/resolve-checkout-generation';

let installationPromise: Promise<string> | undefined;

export type CheckoutAttemptKeyOptions = {
  frozen?: boolean;
  persistFrozen?: boolean;
  liveGeneration?: string;
};

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toCheckoutIdempotencyInput(
  payload: Record<string, unknown>
): OrderIdempotencyPayloadInput {
  const shipping = payload.shipping_address;
  const shippingRecord =
    shipping && typeof shipping === 'object' && !Array.isArray(shipping)
      ? (shipping as Record<string, unknown>)
      : null;

  return {
    airport_type: asString(payload.airport_type) || null,
    customer_email: asString(payload.customer_email),
    customer_name: asString(payload.customer_name),
    customer_phone: asString(payload.customer_phone) || null,
    delivery_method: asString(payload.delivery_method) || null,
    discount_amount: asNumber(payload.discount_amount),
    discount_code: asString(payload.discount_code) || null,
    gift_wrapping_fee: asNumber(payload.gift_wrapping_fee),
    items: Array.isArray(payload.items)
      ? (payload.items as OrderIdempotencyPayloadInput['items'])
      : [],
    merchant_id: asString(payload.merchant_id),
    savings_amount: asNumber(payload.savings_amount) ?? null,
    savings_goal_id: asString(payload.savings_goal_id) || null,
    selected_quote_id: asString(payload.selected_quote_id) || null,
    shipping_address: shippingRecord
      ? {
          address: asString(shippingRecord.address) || null,
          city: asString(shippingRecord.city) || null,
          state: asString(shippingRecord.state) || null,
        }
      : null,
    shipping_fee: asNumber(payload.shipping_fee),
    shipping_provider: asString(payload.shipping_provider) || null,
    shipping_rate_id: asString(payload.shipping_rate_id) || null,
    tax_amount: asNumber(payload.tax_amount),
    use_savings_credit: asBool(payload.use_savings_credit),
    use_wallet_credit: asBool(payload.use_wallet_credit),
    wallet_amount: asNumber(payload.wallet_amount),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

/** Same cart lifecycle and exact request resume the same server-owned order. */
export async function getCheckoutAttemptKey(
  payload: Record<string, unknown>,
  checkoutGeneration: string,
  options?: CheckoutAttemptKeyOptions
): Promise<string> {
  installationPromise ??= loadInstallationId().catch((error: unknown) => {
    installationPromise = undefined;
    throw error;
  });
  const installationId = await installationPromise;
  const generation = await resolveCheckoutGeneration(checkoutGeneration, {
    frozen: options?.frozen,
    persistFrozen: options?.persistFrozen,
    liveGeneration: options?.liveGeneration,
  });
  // The server intentionally excludes the selected gateway from its checkout
  // hash so switching payment methods resumes the same pending order.
  const recoveryPayload = await applyCheckoutCreditSnapshot(
    Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) => key !== 'payment_method' && key !== 'payment_status'
      )
    ),
    generation
  );
  // Only an opaque installation ID is stored here, never checkout PII. Identity
  // hashes the server checkout projection plus local retry partitions.
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(
      canonicalize({
        authPartition: recoveryPayload.user_id,
        checkoutGeneration: generation,
        installationId,
        payload: buildOrderIdempotencyPayload(
          toCheckoutIdempotencyInput(recoveryPayload)
        ),
      })
    )
  );
}
