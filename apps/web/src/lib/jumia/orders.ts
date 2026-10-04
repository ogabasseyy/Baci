/**
 * Jumia Vendor Center API — Orders submodule
 * Order listing, items, shipment providers
 */

import type { JumiaClient } from '@/lib/jumia/client';
import type {
  JumiaOrder,
  JumiaOrderItemsResponse,
  JumiaShipmentProvidersResponse,
} from '@/schemas/jumia';
import {
  JumiaOrderItemsResponseSchema,
  JumiaOrdersResponseSchema,
  JumiaShipmentProvidersResponseSchema,
} from '@/schemas/jumia';

/** Safety limit for paginated fetches to prevent infinite loops. */
export const MAX_PAGES = 1000;

// ── Orders ──

export async function getOrders(
  client: JumiaClient,
  params?: {
    status?: string;
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    country?: string;
    shopId?: string;
    sort?: string;
    size?: number;
    nextToken?: string;
  }
): Promise<{
  orders: JumiaOrder[];
  nextToken: string | null;
  isLastPage: boolean;
}> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.createdAfter) query.set('createdAfter', params.createdAfter);
  if (params?.createdBefore) query.set('createdBefore', params.createdBefore);
  if (params?.updatedAfter) query.set('updatedAfter', params.updatedAfter);
  if (params?.updatedBefore) query.set('updatedBefore', params.updatedBefore);
  if (params?.country) query.set('country', params.country);
  if (params?.shopId) query.set('shopId', params.shopId);
  if (params?.sort) query.set('sort', params.sort);
  if (params?.size != null) query.set('size', params.size.toString());
  if (params?.nextToken) query.set('nextToken', params.nextToken);

  const qs = query.toString();
  const path = qs ? `/orders?${qs}` : '/orders';
  const response = await client.request('GET', path, JumiaOrdersResponseSchema);

  return {
    orders: response.orders,
    nextToken: response.nextToken ?? null,
    isLastPage: response.isLastPage,
  };
}

export async function getAllOrders(
  client: JumiaClient,
  params?: Omit<Parameters<typeof getOrders>[1], 'nextToken'>
): Promise<JumiaOrder[]> {
  const all: JumiaOrder[] = [];
  let nextToken: string | null = null;
  let pageCount = 0;

  do {
    if (++pageCount > MAX_PAGES) {
      throw new Error(
        `getAllOrders exceeded ${MAX_PAGES} pages — aborting to prevent infinite loop`
      );
    }
    const page = await getOrders(client, {
      ...params,
      nextToken: nextToken ?? undefined,
    });
    all.push(...page.orders);
    nextToken = page.nextToken;
    if (page.isLastPage) break;
    if (!nextToken) {
      // API says not last page but gave no token — abort rather than silently dropping orders
      throw new Error(
        'getAllOrders: API returned isLastPage=false but no nextToken — aborting'
      );
    }
  } while (nextToken);

  return all;
}

// ── Order Items ──

export async function getOrderItems(
  client: JumiaClient,
  orderId: string
): Promise<JumiaOrderItemsResponse> {
  const trimmedOrderId = orderId.trim();
  if (!trimmedOrderId) {
    throw new Error('orderId must be a non-empty string');
  }
  const params = new URLSearchParams({ orderId: trimmedOrderId });
  return await client.request(
    'GET',
    `/orders/items?${params.toString()}`,
    JumiaOrderItemsResponseSchema
  );
}

// ── Shipment Providers ──

export async function getShipmentProviders(
  client: JumiaClient,
  orderItemIds: string[]
): Promise<JumiaShipmentProvidersResponse> {
  if (!orderItemIds.length) {
    throw new Error('orderItemIds must contain at least one id');
  }
  const query = new URLSearchParams();
  for (const id of orderItemIds) {
    const trimmedId = id.trim();
    if (!trimmedId) {
      throw new Error('Each orderItemId must be a non-empty string');
    }
    query.append('orderItemId', trimmedId);
  }
  return await client.request(
    'GET',
    `/orders/shipment-providers?${query.toString()}`,
    JumiaShipmentProvidersResponseSchema
  );
}
