import { router } from 'expo-router';
import { Alert } from 'react-native';
import {
  type PersistedRedvaultOrder,
  readPersistedRedvaultOrder,
  resolvePersistedRedvaultOrder,
} from '@/lib/pending-redvault-order';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';

export type FencedRedvaultOrderState = {
  id: string;
  order_number?: string;
  total?: number | string;
  payment_status?: string;
  shipping_status?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOrderState(value: unknown): FencedRedvaultOrderState | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    ...(typeof value.order_number === 'string'
      ? { order_number: value.order_number }
      : {}),
    ...(typeof value.total === 'number' || typeof value.total === 'string'
      ? { total: value.total }
      : {}),
    ...(typeof value.payment_status === 'string'
      ? { payment_status: value.payment_status }
      : {}),
    ...(typeof value.shipping_status === 'string'
      ? { shipping_status: value.shipping_status }
      : {}),
  };
}

/**
 * Validates a persisted REDVAULT fence against the server. Guest-capable:
 * the fence's tracking token authorizes the public order lookup without a
 * Supabase session, so a guest who killed the app can still resolve the
 * fence. Only legacy records persisted without a token fall back to the
 * session-bound account endpoint (authed shoppers only).
 */
export async function fetchFencedRedvaultOrderState(
  persisted: PersistedRedvaultOrder
): Promise<FencedRedvaultOrderState> {
  if (persisted.trackingToken) {
    const params = new URLSearchParams({
      tracking_token: persisted.trackingToken,
      merchant_slug: CHECKOUT_MERCHANT_SLUG,
    });
    const response = await fetch(
      `${CHECKOUT_API_BASE_URL}/api/storefront/orders/${persisted.orderId}?${params.toString()}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) {
      throw new Error(
        `Unable to verify pending UBA payment (${response.status})`
      );
    }
    const state = readOrderState(await response.json());
    if (!state) {
      throw new Error('Unable to verify pending UBA payment');
    }
    return state;
  }
  const fenceClient = createStorefrontCustomerApiClient();
  const validated = await fenceClient.fetchJson({
    method: 'GET',
    path: `/api/storefront/account/orders/${persisted.orderId}`,
  });
  const state = isRecord(validated) ? readOrderState(validated.order) : null;
  if (!state) {
    throw new Error('Unable to verify pending UBA payment');
  }
  return state;
}

export type ResolveCheckoutRedvaultFenceResult =
  | {
      readonly proceed: true;
      readonly paidOrderId?: string;
      readonly paidOrderNumber?: string;
      readonly paidTrackingToken?: string;
    }
  | { readonly proceed: false };

/**
 * Routes to an already-paid fenced order instead of resuming checkout: the
 * cart is cleared first so the paid merchandise cannot be ordered again.
 */
export async function routeToPaidFenceOrder({
  clearCart,
  orderId,
  orderNumber,
  trackingToken,
}: {
  clearCart: () => void | Promise<void>;
  orderId: string;
  orderNumber?: string;
  trackingToken?: string;
}): Promise<void> {
  await clearCart();
  router.replace({
    pathname: '/order-success',
    params: {
      orderId,
      ...(orderNumber ? { orderNumber } : {}),
      paymentMethod: 'uba_redvault',
      ...(trackingToken ? { trackingToken } : {}),
    },
  });
}

/**
 * Resolves a persisted REDVAULT fence before a non-REDVAULT submit. After
 * an app kill the in-memory review is gone while the old order may still
 * fence inventory (and may capture), so the server order is validated
 * before checkout proceeds. A paid fence clears and reports paidOrderId so
 * the caller routes to the completed order instead of resuming checkout
 * with the unchanged cart.
 */
export async function resolveCheckoutRedvaultFence(): Promise<ResolveCheckoutRedvaultFenceResult> {
  try {
    const persisted = await readPersistedRedvaultOrder();
    if (!persisted) return { proceed: true };
    const fencedState = await fetchFencedRedvaultOrderState(persisted);
    const fenced = await resolvePersistedRedvaultOrder({
      validateOrder: async () => ({ order: fencedState }),
    });
    if (fenced.blocked) {
      Alert.alert(
        'Payment still processing',
        'Your UBA payment is still being verified. Please wait for it to complete before paying another way.'
      );
      return { proceed: false };
    }
    if (fenced.paidOrderId) {
      return {
        proceed: true,
        paidOrderId: fenced.paidOrderId,
        ...(fencedState.order_number
          ? { paidOrderNumber: fencedState.order_number }
          : {}),
        ...(persisted.trackingToken
          ? { paidTrackingToken: persisted.trackingToken }
          : {}),
      };
    }
    return { proceed: true };
  } catch {
    Alert.alert(
      'Unable to verify pending payment',
      'We could not check your pending UBA payment. Please try again.'
    );
    return { proceed: false };
  }
}
