import { notFound } from 'next/navigation';
import { getMerchantForUser } from '@/lib/merchant-server';
import { shouldShowOrderRefundPanel } from '@/lib/orders/should-show-order-refund-panel';
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
    order = await getOrder(merchant.id, orderId);
  } catch (error) {
    console.error('Failed to fetch order:', error);
    return notFound();
  }

  if (!order) {
    return notFound();
  }

  // The summary fetch chains after the order (never parallel): most
  // orders cannot show the panel, and getOrder resolves order_number
  // identifiers to the canonical UUID the uuid-typed RPC needs. The
  // gate mirrors the section exactly, so a shown panel always paints
  // first content from the server instead of flashing a loader.
  const initialRefundSummary = shouldShowOrderRefundPanel(order)
    ? await getInitialRefundSummary(order.id)
    : null;
  return (
    <OrderDetailsClientPage
      initialOrder={order}
      initialRefundSummary={initialRefundSummary}
    />
  );
}
