import type { OrderSource, VariantAttributes } from '@baci/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BASE_URL } from '@/lib/api-client';
import { useMerchant } from '../useMerchant';
import { createAuthenticatedFetch } from './authenticated-fetch';
import { parseResponsePayload } from './response-utils';

const UPDATE_ORDER_TIMEOUT_MS = 15_000;

export interface UpdateOrderItemPayload {
  condition?: string | null;
  image_url?: string | null;
  item_description?: string | null;
  name: string;
  price: number;
  product_id: string | null;
  product_match_status?: 'custom' | 'linked' | 'unreviewed';
  quantity: number;
  variant_attributes?: VariantAttributes | null;
  variant_id: string | null;
  variant_name: string | null;
}

export interface UpdateOrderPayload {
  transaction_date?: string;
  transaction_date_day?: string;
  branch_id: string | null;
  customer: {
    email: string | null;
    id: string | null;
    name: string;
    phone: string | null;
  };
  discount_amount: number;
  gift_wrapping_fee?: number;
  items: UpdateOrderItemPayload[];
  notes: string | null;
  notify_customer: boolean;
  shipping_address: {
    address: string;
    city?: string | null;
    name: string;
    phone: string;
    state?: string | null;
  };
  shipping_fee: number;
  source: OrderSource | null;
  tax_amount: number;
}

export interface UpdateOrderResponse {
  edit: {
    change_category?: string;
    changed_fields?: string[];
  };
  order: {
    id: string;
  } & Record<string, unknown>;
  order_refresh_failed?: boolean;
}

interface UpdateOrderVariables {
  orderId: string;
  payload: UpdateOrderPayload;
}

function isUpdateOrderResponse(value: unknown): value is UpdateOrderResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as { order?: unknown };
  if (!response.order || typeof response.order !== 'object') {
    return false;
  }

  return typeof (response.order as { id?: unknown }).id === 'string';
}

async function updateOrder({
  orderId,
  payload,
}: UpdateOrderVariables): Promise<UpdateOrderResponse> {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/orders/${orderId}/edit`,
    {
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
    UPDATE_ORDER_TIMEOUT_MS
  );
  const responseText = await response.text();
  const parsed = parseResponsePayload(responseText);

  if (!response.ok) {
    const errorMessage =
      parsed && typeof parsed === 'object' && typeof parsed.error === 'string'
        ? parsed.error
        : responseText ||
          `Request failed: ${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  if (!isUpdateOrderResponse(parsed)) {
    throw new Error('Failed to update order');
  }

  return parsed;
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  const { merchant } = useMerchant();

  return useMutation<UpdateOrderResponse, Error, UpdateOrderVariables>({
    mutationFn: updateOrder,
    mutationKey: ['updateOrder'],
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['order', variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders', merchant?.id] });
      queryClient.invalidateQueries({
        queryKey: ['order-audit-events', variables.orderId],
      });
      queryClient.invalidateQueries({
        queryKey: ['dashboard-stats', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['order-counts', merchant?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['transaction-review', merchant?.id],
      });
      // Date edits can move a paid order into or out of the current month.
      queryClient.invalidateQueries({
        queryKey: ['monthly-transaction-count', merchant?.id],
      });
    },
  });
}
