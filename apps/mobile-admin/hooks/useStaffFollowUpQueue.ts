import { useAuth } from '@/hooks/useAuth';
import { useFollowUpQueue } from '@/hooks/useFollowUpQueue';
import { useStaffOrderFollowUps } from '@/hooks/useStaffOrderFollowUps';

export function useStaffFollowUpQueue() {
  const source = useFollowUpQueue();
  const { user } = useAuth();
  const orderIds = source.failedOrders?.map((order) => order.id).sort() ?? [];
  const staff = useStaffOrderFollowUps(source.merchant?.id, user?.id, orderIds);

  // Keep the checkout feed’s payment context when both scans include an order.
  const ordersById = new Map(
    [...(staff.openOrders ?? []), ...(source.failedOrders ?? [])].map(
      (order) => [order.id, order]
    )
  );
  const orders = [...ordersById.values()].filter(
    (order) => staff.data?.[order.id]?.stage !== 'closed'
  );

  return { source, staff, orders, ordersById, viewerId: user?.id };
}
