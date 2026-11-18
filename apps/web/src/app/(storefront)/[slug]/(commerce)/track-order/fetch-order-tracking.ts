import type { OrderData } from './track-order-types';

export interface TrackingLookupParams {
  order_id?: string | null;
  order_number?: string | null;
  email?: string | null;
  tracking_token?: string | null;
}

type TrackingLookupResult =
  | { data: OrderData; error: null }
  | { data: null; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessageOf(data: unknown): string | null {
  return isRecord(data) && typeof data.error === 'string' ? data.error : null;
}

/** The fields the page reads without further checks. */
function isOrderData(data: unknown): data is OrderData {
  return (
    isRecord(data) &&
    isRecord(data.order) &&
    isRecord(data.customer) &&
    Array.isArray(data.items)
  );
}

/**
 * Module-scope lookup keeps the try/finally and throw statements out of the
 * component body so React Compiler can memoize the page.
 */
export async function fetchOrderTracking(
  merchantSlug: string | undefined,
  trackingParams: TrackingLookupParams
): Promise<TrackingLookupResult> {
  try {
    if (!merchantSlug) {
      throw new Error('Store identifier is missing.');
    }
    // Token-based lookup doesn't need email; manual form does
    if (!trackingParams.tracking_token && !trackingParams.email) {
      throw new Error('Email is required to track an order.');
    }

    const queryParams = new URLSearchParams();
    if (trackingParams.tracking_token) {
      queryParams.set('token', trackingParams.tracking_token);
    } else {
      if (trackingParams.order_id)
        queryParams.set('order_id', trackingParams.order_id);
      if (trackingParams.order_number)
        queryParams.set('order_number', trackingParams.order_number);
      if (trackingParams.email) queryParams.set('email', trackingParams.email);
    }
    queryParams.set('merchant_slug', merchantSlug);

    const response = await fetch(
      `/api/storefront/orders/track-order?${queryParams}`
    );
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('Unexpected server response. Please try again later.');
    }

    if (!response.ok) {
      throw new Error(errorMessageOf(data) || 'Failed to find order');
    }
    if (!isOrderData(data)) {
      throw new Error('Unexpected server response. Please try again later.');
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'An error occurred',
    };
  }
}
