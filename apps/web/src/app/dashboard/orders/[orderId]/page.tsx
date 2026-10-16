import { notFound } from 'next/navigation';
import { getMerchantForUser } from '@/lib/merchant-server';
import { getOrder, type Order } from '../actions';
import OrderDetailsClientPage from './client-page';
import { getInitialRefundSummary } from './initial-refund-summary';

export const metadata = {
  title: 'Order Details - Baci',
};

type Props = {
  params: Promise<{ orderId: string }>;
};

export default async function OrderDetailsPage({ params }: Props) {
  const { orderId } = await params;
  const { merchant } = await getMerchantForUser();

  if (!merchant) {
    return notFound();
  }

  let order: Order | null;
  try {
    // The refund summary rides alongside the order fetch (parallel,
    // not chained): the panel paints first content from it instead
    // of flashing a loader while its mount fetch resolves.
    const [fetchedOrder, initialRefundSummary] = await Promise.all([
      getOrder(merchant.id, orderId),
      getInitialRefundSummary(orderId),
    ]);
    order = fetchedOrder;
    if (!order) {
      return notFound();
    }
    return (
      <OrderDetailsClientPage
        initialOrder={order}
        initialRefundSummary={initialRefundSummary}
      />
    );
  } catch (error) {
    console.error('Failed to fetch order:', error);
    return notFound();
  }
}
