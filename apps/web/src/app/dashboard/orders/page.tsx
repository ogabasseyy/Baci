import { getMerchantForUser } from '@/lib/merchant-server';
import { getOrderStats, getOrders } from './actions';
import { parseAgenticOrderSourceFilter } from './agentic-order-source';
import OrdersClientPage from './client-page';
import { parseJumiaOrderSourceFilter } from './jumia-order-source-filter';

export const metadata = {
  title: 'Orders - Baci',
};

interface OrdersPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const sourceFilter =
    parseAgenticOrderSourceFilter(resolvedSearchParams.source) ??
    parseJumiaOrderSourceFilter(resolvedSearchParams.source);
  const jumiaIntegrationId =
    typeof resolvedSearchParams.integrationId === 'string' &&
    resolvedSearchParams.integrationId.trim().length > 0
      ? resolvedSearchParams.integrationId.trim()
      : undefined;
  const { merchant } = await getMerchantForUser();

  if (!merchant) {
    return <OrdersClientPage />;
  }

  // Use Promise.allSettled to handle partial failures gracefully
  const results = await Promise.allSettled([
    sourceFilter || jumiaIntegrationId
      ? getOrders(merchant.id, {
          ...(sourceFilter ? { source: sourceFilter } : {}),
          ...(jumiaIntegrationId ? { jumiaIntegrationId } : {}),
        })
      : getOrders(merchant.id),
    getOrderStats(merchant.id),
  ]);

  const orders = results[0].status === 'fulfilled' ? results[0].value : [];
  const initialOrdersError =
    results[0].status === 'rejected' ? 'Could not load orders.' : null;
  const stats =
    results[1].status === 'fulfilled' ? results[1].value : undefined;

  // Log any errors for debugging
  if (results[0].status === 'rejected') {
    console.error('Failed to fetch orders:', results[0].reason);
  }
  if (results[1].status === 'rejected') {
    console.error('Failed to fetch order stats:', results[1].reason);
  }

  return (
    <OrdersClientPage
      initialOrders={orders}
      initialOrdersError={initialOrdersError}
      initialStats={stats}
    />
  );
}
