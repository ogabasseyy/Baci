export interface StorefrontOrderData {
  id: string;
  order_number: string;
  short_id?: string;
  tracking_token?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  shipping_address?: Record<string, unknown>;
  payment_status?: string;
  payment_method?: string;
  shipping_status?: string;
  merchant_id?: string;
  currency?: string;
  items: Array<{
    id: string;
    product_name?: string;
    name?: string;
    gtin?: string | null;
    price: number;
    quantity: number;
    product_images?: string[];
  }>;
  subtotal: number;
  shipping_cost: number;
  total: number;
  amount_paid?: number;
  virtual_account?: {
    account_name: string | null;
    account_number: string;
    bank_name: string | null;
  } | null;
}

export async function fetchStorefrontOrderData(
  orderId: string,
  merchantSlug: string | undefined,
  orderToken: string | null,
  lookupEmail: string | null = null,
  signal?: AbortSignal
): Promise<StorefrontOrderData | null> {
  try {
    const query = new URLSearchParams();
    if (merchantSlug) query.set('merchant_slug', merchantSlug);
    if (orderToken) query.set('token', orderToken);
    if (!orderToken && lookupEmail) query.set('email', lookupEmail);
    const url = query.toString()
      ? `/api/storefront/orders/${orderId}?${query.toString()}`
      : `/api/storefront/orders/${orderId}`;

    // Use storefront endpoint (guest-accessible, token-based). The
    // options argument is omitted entirely without a signal so plain
    // single-argument fetch callers keep their exact call shape.
    const res = signal ? await fetch(url, { signal }) : await fetch(url);
    if (res.ok) {
      return (await res.json()) as StorefrontOrderData;
    }
  } catch (err) {
    // Lookup timeouts abort the fetch: expected control flow, not an
    // error worth logging — the poll simply retries on schedule.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch order', err);
  }

  return null;
}
