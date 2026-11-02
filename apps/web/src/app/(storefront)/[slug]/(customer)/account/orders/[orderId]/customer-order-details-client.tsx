'use client';

import { Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CustomerOrderDetailsContent } from '@/app/(storefront)/[slug]/(customer)/account/orders/[orderId]/customer-order-details-content';
import { OrderStateCard } from '@/app/(storefront)/[slug]/(customer)/account/orders/[orderId]/order-state-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchant } from '@/hooks/use-merchant-client';
import { asRoute } from '@/lib/routes';
import type { StorefrontOrder } from '@/types/storefront-order';

type OrderFetchResult =
  | { status: 'aborted' }
  | { status: 'error'; message: string }
  | { status: 'success'; order: StorefrontOrder | null };

// Module-scope helper: React Compiler cannot yet compile try blocks inside a
// component body that rely on early returns, so the fetch lives out here.
async function fetchCustomerOrder(
  orderId: string,
  merchantSlug: string,
  signal: AbortSignal
): Promise<OrderFetchResult> {
  try {
    const response = await fetch(
      `/api/storefront/account/orders/${orderId}?merchantSlug=${encodeURIComponent(merchantSlug)}`,
      { signal }
    );
    const data = (await response.json()) as {
      error?: string;
      order?: StorefrontOrder;
    };

    if (!response.ok) {
      return {
        status: 'error',
        message: data.error || 'Unable to load this order',
      };
    }

    return { status: 'success', order: data.order ?? null };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'aborted' };
    }

    return { status: 'error', message: 'Unable to connect. Please try again.' };
  }
}

export default function CustomerOrderDetailsClient() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : null;
  const { merchant, loading: merchantLoading, basePath } = useMerchant();
  const {
    customer,
    isAuthenticated,
    isLoading: authLoading,
  } = useCustomerAuth();
  const [loadedOrder, setLoadedOrder] = useState<{
    key: string;
    order: StorefrontOrder | null;
    error: string | null;
  } | null>(null);
  // Bumped to force a re-fetch of the order after a state change (e.g. a
  // customer cancellation) so the server-derived `can_cancel` flag and status
  // badges stay in sync.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const resolvedBasePath = basePath || '';

  // Loading state is derived from the request key instead of being mirrored
  // into state, so the fetch effect only sets state from async results. When
  // we cannot fetch (no session yet, missing orderId, etc.) the key is null
  // and the derived loading flag is off, letting the auth-redirect /
  // missing-param UI below show instead of an endless skeleton.
  const requestKey =
    customer && merchant?.slug && orderId
      ? `${customer.id}|${merchant.slug}|${orderId}|${refreshNonce}`
      : null;

  useEffect(() => {
    if (!merchantLoading && !authLoading && !isAuthenticated) {
      const redirectPath = orderId
        ? `${resolvedBasePath}/account/orders/${orderId}`
        : `${resolvedBasePath}/account/orders`;
      router.push(
        asRoute(
          `${resolvedBasePath}/account/login?redirect=${encodeURIComponent(
            redirectPath
          )}`
        )
      );
    }
  }, [
    merchantLoading,
    authLoading,
    isAuthenticated,
    orderId,
    resolvedBasePath,
    router,
  ]);

  useEffect(() => {
    if (!requestKey || !customer || !merchant?.slug || !orderId) {
      return;
    }

    const controller = new AbortController();

    void fetchCustomerOrder(orderId, merchant.slug, controller.signal).then(
      (result) => {
        if (result.status === 'aborted' || controller.signal.aborted) {
          return;
        }

        setLoadedOrder({
          key: requestKey,
          order: result.status === 'success' ? result.order : null,
          error: result.status === 'error' ? result.message : null,
        });
      }
    );

    return () => {
      controller.abort();
    };
  }, [requestKey, customer, merchant?.slug, orderId]);

  const hasFreshOrderResult =
    loadedOrder !== null && loadedOrder.key === requestKey;
  const order = hasFreshOrderResult ? loadedOrder.order : null;
  const orderError = hasFreshOrderResult ? loadedOrder.error : null;
  const isLoadingOrder = requestKey !== null && !hasFreshOrderResult;

  if (merchantLoading || authLoading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="mb-4 h-48" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <OrderStateCard
        title="Redirecting to sign in"
        message="Please sign in to view this order."
        actionLabel="Go to sign in"
        actionHref={asRoute(
          `${resolvedBasePath}/account/login?redirect=${encodeURIComponent(
            orderId
              ? `${resolvedBasePath}/account/orders/${orderId}`
              : `${resolvedBasePath}/account/orders`
          )}`
        )}
      />
    );
  }

  if (!customer) {
    return (
      <OrderStateCard
        title="Customer account unavailable"
        message="We could not load your customer profile for this storefront."
        actionLabel="Back to account"
        actionHref={asRoute(`${resolvedBasePath}/account`)}
      />
    );
  }

  if (!merchant?.slug) {
    return (
      <OrderStateCard
        title="Store unavailable"
        message="We could not load this storefront right now."
        actionLabel="Back to orders"
        actionHref={asRoute(`${resolvedBasePath}/account/orders`)}
      />
    );
  }

  if (isLoadingOrder) {
    return (
      <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <div className="flex items-center justify-center py-20">
            <output aria-label="Loading order" className="sr-only">
              Loading order
            </output>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  if (!order || orderError) {
    return (
      <OrderStateCard
        title="Order unavailable"
        message={orderError || 'We could not load this order.'}
        actionLabel="Back to orders"
        actionHref={asRoute(`${resolvedBasePath}/account/orders`)}
      />
    );
  }

  return (
    <CustomerOrderDetailsContent
      order={order}
      basePath={resolvedBasePath}
      merchantSlug={merchant.slug}
      onOrderChanged={() => setRefreshNonce((nonce) => nonce + 1)}
    />
  );
}
