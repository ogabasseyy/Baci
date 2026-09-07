import type { Order, ShippingStatus } from '@baci/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_URL } from '@/lib/api-client';
import { useMerchant } from '../useMerchant';
import { createAuthenticatedFetch } from './authenticated-fetch';
import { OrderStatusUpdateError } from './order-status-update-error';
import type { OrdersPage } from './order-types';
import { parseResponsePayload } from './response-utils';

const ORDER_STATUS_UPDATE_TIMEOUT_MS = 15000;
const IS_DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

interface OrderStatusContext {
  previousOrderQueries: [readonly unknown[], Order | undefined][];
  previousOrders: [readonly unknown[], InfiniteData<OrdersPage> | undefined][];
}

interface OrderStatusVariables {
  orderId: string;
  status: ShippingStatus;
}

async function updateOrderStatus(
  orderId: string,
  status: ShippingStatus
): Promise<Order> {
  const isCancellation = status === 'cancelled';
  const url = `${BASE_URL}/api/orders/${orderId}${isCancellation ? '/cancelled' : ''}`;

  if (IS_DEV_RUNTIME) {
    console.log('[OrderStatus] PATCH start', { orderId, status, url });
  }

  let response: Response;
  try {
    response = await createAuthenticatedFetch(
      url,
      {
        body: JSON.stringify({
          ...(isCancellation
            ? { cancelled_by: 'merchant', confirm_cancellation: true }
            : { shipping_status: status }),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: isCancellation ? 'POST' : 'PATCH',
      },
      ORDER_STATUS_UPDATE_TIMEOUT_MS
    );
  } catch (error: unknown) {
    if (IS_DEV_RUNTIME) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[OrderStatus] PATCH request failed', {
        message,
        orderId,
        status,
        url,
      });
    }

    throw error;
  }

  const responseText = await response.text();
  const payload = parseResponsePayload(responseText);

  if (!response.ok) {
    const errorMessage =
      payload &&
      typeof payload === 'object' &&
      typeof payload.error === 'string'
        ? payload.error
        : responseText ||
          `Request failed: ${response.status} ${response.statusText}`;
    if (IS_DEV_RUNTIME) {
      console.warn('[OrderStatus] PATCH response failed', {
        errorMessage,
        orderId,
        status,
        statusCode: response.status,
        url,
      });
    }

    throw new OrderStatusUpdateError(
      errorMessage,
      payload && typeof payload === 'object' && typeof payload.code === 'string'
        ? payload.code
        : undefined,
      payload && typeof payload === 'object' ? payload : undefined
    );
  }

  if (isCancellation) {
    return { id: orderId, shipping_status: 'cancelled' } as Order;
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('order' in payload) ||
    !payload.order
  ) {
    throw new Error('Failed to update order status');
  }

  return payload.order as Order;
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { merchant } = useMerchant();

  return useMutation<Order, Error, OrderStatusVariables, OrderStatusContext>({
    mutationFn: ({ orderId, status }) => {
      if (!merchant?.id) {
        throw new Error('Merchant ID is required');
      }

      return updateOrderStatus(orderId, status);
    },
    mutationKey: ['updateOrderStatus'],
    retry: false,
    onError: (_err, _vars, context) => {
      context?.previousOrders?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousOrderQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onMutate: async ({ orderId, status }) => {
      if (!merchant?.id) {
        return { previousOrderQueries: [], previousOrders: [] };
      }

      await queryClient.cancelQueries({ queryKey: ['orders', merchant.id] });
      await queryClient.cancelQueries({ queryKey: ['order', orderId] });

      const previousOrders = queryClient.getQueriesData<
        InfiniteData<OrdersPage>
      >({
        queryKey: ['orders', merchant.id],
      });

      queryClient.setQueriesData<InfiniteData<OrdersPage>>(
        { queryKey: ['orders', merchant.id] },
        (old) => {
          if (!old?.pages) {
            return old;
          }

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              orders: page.orders.map((order) =>
                order.id === orderId
                  ? { ...order, shipping_status: status }
                  : order
              ),
            })),
          };
        }
      );

      const previousOrderQueries = queryClient.getQueriesData<Order>({
        queryKey: ['order', orderId],
      });

      queryClient.setQueriesData<Order>(
        { queryKey: ['order', orderId] },
        (old) => {
          if (!old) {
            return old;
          }

          return { ...old, shipping_status: status };
        }
      );

      return { previousOrderQueries, previousOrders };
    },
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({ queryKey: ['orders', merchant?.id] });
      queryClient.invalidateQueries({ queryKey: ['order', vars.orderId] });
      queryClient.invalidateQueries({
        queryKey: ['transaction-review', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['dashboard-stats', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['order-counts', merchant?.id],
      });
    },
  });
}
