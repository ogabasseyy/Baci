import { useAuth } from '@/hooks/useAuth';
import { useFollowUpQueue } from '@/hooks/useFollowUpQueue';
import { useStaffOrderFollowUps } from '@/hooks/useStaffOrderFollowUps';
import { compareFollowUpDatesDesc } from '@/lib/compare-follow-up-dates-desc';
import { getFollowUpActivityAt } from '@/lib/customers-failed-orders';

export function useStaffFollowUpQueue() {
  const source = useFollowUpQueue();
  const { user } = useAuth();
  const orderIds = source.failedOrders?.map((order) => order.id).sort() ?? [];
  const staff = useStaffOrderFollowUps(source.merchant?.id, user?.id, orderIds);

  const ordersById = new Map(
    (staff.openOrders ?? []).map((order) => [order.id, order])
  );
  // Keep source payment details and use the newest activity from either feed.
  for (const order of source.failedOrders ?? []) {
    const staffActivity = staff.data?.[order.id]?.updated_at;
    const staffIsNewer =
      staffActivity &&
      compareFollowUpDatesDesc(staffActivity, getFollowUpActivityAt(order)) < 0;
    ordersById.set(
      order.id,
      staffIsNewer ? { ...order, follow_up_at: staffActivity } : order
    );
  }
  const orders = [...ordersById.values()].filter(
    (order) => staff.data?.[order.id]?.stage !== 'closed'
  );

  const confirmedCount = staff.data ? orders.length : 0;
  return {
    source,
    staff,
    orders,
    ordersById,
    confirmedCount,
    viewerId: user?.id,
  };
}
