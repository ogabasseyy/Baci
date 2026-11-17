import type { FailedOrder } from '@/hooks/useFailedOrders';
import type { OxygenFollowUpStatus } from '@/schemas/oxygen-follow-up';

const OXYGEN_LABELS: Record<OxygenFollowUpStatus, string> = {
  customer_action: 'Oxygen · Customer needs to continue',
  oxygen_processing: 'Oxygen · Processing',
  approved_pending: 'Oxygen · Approved, action pending',
  needs_review: 'Oxygen · Review needed',
};

const PAYMENT_LABELS: Record<string, string> = {
  bnpl_pending: 'BNPL Drop-off',
  failed: 'Payment Failed',
  pending: 'Abandoned Transfer',
  expired: 'Payment Expired',
  unpaid: 'Checkout Drop-off',
};

export function getFollowUpStatusLabel(order: FailedOrder): string {
  if (order.oxygen_follow_up_status)
    return OXYGEN_LABELS[order.oxygen_follow_up_status];
  if (order.attempt_count > 1) return `${order.attempt_count} attempts`;
  const message = order.gateway_response?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return PAYMENT_LABELS[order.payment_status] ?? 'Payment Failed';
}
