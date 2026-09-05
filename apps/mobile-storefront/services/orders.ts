import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { DEFAULT_TIMEOUT, fetchWithRetry } from '@/lib/api';
import { resolveApiBaseUrl } from '@/lib/api-url';
import { getCheckoutAttemptKey } from '@/lib/checkout-attempt-key';
import { createLogger } from '@/lib/logger';
import { offlineQueue } from '@/lib/offline-queue';
import {
  supabase,
  supabaseAuthStorage,
  supabaseAuthStorageKey,
} from '@/lib/supabase';
import { trackEvent } from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import {
  mapCreateOrderException,
  OrderError,
  throwOrderHttpError,
} from './orders.errors';
import { buildOrderPayload } from './orders.payload';
import { parseOrderResponse } from './orders.response';
import {
  type CreateOrderRequest,
  CreateOrderRequestSchema,
  type OrderResponse,
} from './orders.schemas';
import { resolveCheckoutAuth } from './orders-auth';
import { getCheckoutStoredSession } from './orders-session';

export { OrderError } from './orders.errors';
export type {
  CreateOrderRequest,
  OrderItem,
  OrderResponse,
} from './orders.schemas';

const log = createLogger('Order');

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);

const MERCHANT_ID =
  Constants.expoConfig?.extra?.merchantId ||
  '6b5cb8a4-5575-456c-b936-8cdfae30db74';

const CHECKOUT_USER_VALIDATION_TIMEOUT_MS = 4_000;

async function validateCheckoutUser(accessToken: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{
    data: { user: null };
    error: Error;
  }>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          data: { user: null },
          error: new Error('Checkout user validation timed out'),
        }),
      CHECKOUT_USER_VALIDATION_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([supabase.auth.getUser(accessToken), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkNetwork(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

export async function createOrder(
  request: CreateOrderRequest
): Promise<OrderResponse> {
  const startTime = Date.now();
  const checkoutGeneration = useCartStore.getState().checkoutGeneration;

  const validationResult = CreateOrderRequestSchema.safeParse(request);
  if (!validationResult.success) {
    const errorMessage = validationResult.error.issues
      .map((e: { message: string }) => e.message)
      .join(', ');
    throw new OrderError(
      errorMessage,
      'VALIDATION_ERROR',
      validationResult.error
    );
  }
  const validatedRequest = validationResult.data;

  const isOnline = await checkNetwork();
  if (!isOnline) {
    throw new OrderError(
      'No internet connection. Please check your network and try again.',
      'NETWORK_ERROR'
    );
  }

  // 3. Auth is optional because the storefront supports guest checkout.
  // When a valid session exists, forward it so the server can link the order.
  const storedSession = await getCheckoutStoredSession(
    supabaseAuthStorage,
    supabaseAuthStorageKey
  );
  // A persisted token can still be accepted by Auth while the Data API no
  // longer has a compatible signing key for it. Refresh before the money/order
  // boundary so PostgREST receives a token minted by the active signing key.
  const checkoutAuth = await resolveCheckoutAuth(
    supabase.auth,
    storedSession,
    undefined,
    () => getCheckoutStoredSession(supabaseAuthStorage, supabaseAuthStorageKey)
  );
  const { session } = checkoutAuth;
  const {
    data: { user },
    error: authError,
  } =
    checkoutAuth.canValidateUser && session?.access_token
      ? await validateCheckoutUser(session.access_token)
      : { data: { user: null }, error: null };

  const orderPayload = buildOrderPayload({
    merchantId: MERCHANT_ID,
    request: validatedRequest,
    ...(!authError && user?.id && { userId: user.id }),
  });

  try {
    // Local retry partition only: a getUser timeout must not rotate the key.
    // The submitted payload and server authorization remain unchanged.
    const idempotencyKey =
      validatedRequest.idempotency_key ??
      (await getCheckoutAttemptKey(
        {
          ...orderPayload,
          user_id: storedSession?.user?.id ?? orderPayload.user_id,
        },
        checkoutGeneration
      ));
    log.info('Submitting order request', {
      apiUrl: API_URL,
      itemCount: orderPayload.items.length,
      paymentMethod: orderPayload.payment_method,
      paymentStatus: orderPayload.payment_status,
      selectedQuoteId: orderPayload.selected_quote_id,
      shippingFee: orderPayload.shipping_fee,
      shippingProvider: orderPayload.shipping_provider,
      subtotal: orderPayload.subtotal,
      taxAmount: orderPayload.tax_amount,
    });

    const response = await fetchWithRetry(
      `${API_URL}/api/orders`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          ...checkoutAuth.authorizationHeaders,
        },
        body: JSON.stringify(orderPayload),
      },
      {
        // UI retries reuse the persisted checkout identity. Keep transport retries
        // bounded here; a lost response must never rotate the order key.
        maxRetries: 0,
        timeout: DEFAULT_TIMEOUT,
      }
    );

    if (!response.ok) {
      await throwOrderHttpError(response, startTime);
    }

    const normalizedOrderResponse = await parseOrderResponse(response, log);

    trackEvent('order_created', {
      orderId: normalizedOrderResponse.order.id,
      orderNumber: normalizedOrderResponse.order.order_number ?? 'N/A',
      total: normalizedOrderResponse.order.total,
      itemCount: request.items.length,
      paymentMethod: request.payment_method,
      duration_ms: Date.now() - startTime,
      source: 'mobile_app',
    });

    return normalizedOrderResponse;
  } catch (error) {
    throw mapCreateOrderException(error, startTime);
  }
}

export async function getOrder(
  orderId: string,
  customerId: string
): Promise<OrderResponse['order'] | null> {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    throw new OrderError(
      'No internet connection. Please check your network.',
      'NETWORK_ERROR'
    );
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, shipping_status, created_at'
    )
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .single();

  if (error) {
    log.error('Error fetching order', error);
    return null;
  }

  return data;
}

export async function getCustomerOrders(customerId: string) {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    throw new OrderError(
      'No internet connection. Please check your network.',
      'NETWORK_ERROR'
    );
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, shipping_status, created_at, order_items(id, product_id, condition, image_url, name, quantity, price, has_assurance)'
    )
    .eq('customer_id', customerId)
    .eq('merchant_id', MERCHANT_ID)
    .order('created_at', { ascending: false });

  if (error) {
    log.error('Error fetching customer orders', error);
    throw new OrderError('Failed to load orders', 'FETCH_ERROR', error);
  }

  return data || [];
}

export async function createOrderWithOfflineSupport(
  request: CreateOrderRequest
): Promise<{ order: OrderResponse | null; queued: boolean; queueId?: string }> {
  const validationResult = CreateOrderRequestSchema.safeParse(request);
  if (!validationResult.success) {
    const errorMessage = validationResult.error.issues
      .map((e: { message: string }) => e.message)
      .join(', ');
    throw new OrderError(
      errorMessage,
      'VALIDATION_ERROR',
      validationResult.error
    );
  }

  const isOnline = await checkNetwork();

  if (isOnline) {
    try {
      const order = await createOrder(request);
      return { order, queued: false };
    } catch (error) {
      // Only queue errors where the server definitely did NOT receive the request.
      // TIMEOUT_ERROR has unknown outcome — the order may have been created server-side,
      // so queuing it for replay risks creating a duplicate order.
      if (error instanceof OrderError && error.code === 'NETWORK_ERROR') {
        const queueId = await offlineQueue.enqueue('create_order', request);
        trackEvent('order_queued_after_failure', {
          queueId,
          errorCode: error.code,
        });
        return { order: null, queued: true, queueId };
      }
      throw error;
    }
  }

  const queueId = await offlineQueue.enqueue('create_order', request);

  trackEvent('order_queued_offline', {
    queueId,
    itemCount: request.items.length,
  });

  return { order: null, queued: true, queueId };
}
