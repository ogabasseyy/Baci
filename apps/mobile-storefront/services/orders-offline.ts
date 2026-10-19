import NetInfo from '@react-native-community/netinfo';
import { offlineQueue } from '@/lib/offline-queue';
import { wrapQueuedCreateOrder } from '@/lib/wrap-queued-create-order';
import { trackEvent } from '@/services/analytics';
import { useAuthStore } from '@/stores/auth-store';
import { useCartStore } from '@/stores/cart-store';
import { createOrder } from './orders';
import { OrderError } from './orders.errors';
import {
  type CreateOrderRequest,
  CreateOrderRequestSchema,
  type OrderResponse,
} from './orders.schemas';

async function checkNetwork(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

function enqueueCreateOrder(
  request: CreateOrderRequest,
  checkoutGeneration: string,
  authPartition: string
) {
  return offlineQueue.enqueue(
    'create_order',
    wrapQueuedCreateOrder(request, checkoutGeneration, authPartition)
  );
}

export async function createOrderWithOfflineSupport(
  request: CreateOrderRequest
): Promise<{ order: OrderResponse | null; queued: boolean; queueId?: string }> {
  const checkoutGeneration = useCartStore.getState().checkoutGeneration;
  const authPartition = useAuthStore.getState().user?.id ?? 'guest';
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
      const order = await createOrder(request, { checkoutGeneration });
      return { order, queued: false };
    } catch (error) {
      // Only queue errors where the server definitely did NOT receive the request.
      // TIMEOUT_ERROR has unknown outcome — the order may have been created server-side,
      // so queuing it for replay risks creating a duplicate order.
      if (error instanceof OrderError && error.code === 'NETWORK_ERROR') {
        const queueId = await enqueueCreateOrder(
          request,
          checkoutGeneration,
          authPartition
        );
        trackEvent('order_queued_after_failure', {
          queueId,
          errorCode: error.code,
        });
        return { order: null, queued: true, queueId };
      }
      throw error;
    }
  }

  const queueId = await enqueueCreateOrder(
    request,
    checkoutGeneration,
    authPartition
  );

  trackEvent('order_queued_offline', {
    queueId,
    itemCount: request.items.length,
  });

  return { order: null, queued: true, queueId };
}
