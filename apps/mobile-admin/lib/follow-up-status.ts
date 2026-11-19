import { PAYMENT_METHOD_SETTING_DEFINITIONS } from '@baci/shared';
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
  bnpl_approved: 'BNPL Approved',
  failed: 'Payment Failed',
  pending: 'Abandoned Transfer',
  expired: 'Payment Expired',
  unpaid: 'Checkout Drop-off',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  unknown: 'Payment status unavailable',
};

const METHOD_LABELS = new Map([
  ...PAYMENT_METHOD_SETTING_DEFINITIONS.map(
    ({ id, name }) => [id, name] as const
  ),
  ['oxygen', 'Oxygen'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank Transfer'],
  ['transfer', 'Bank Transfer'],
]);

const METHOD_DETAIL_BY_STATUS: Partial<
  Record<FailedOrder['payment_status'], string>
> = {
  bnpl_pending: 'Drop-off',
  bnpl_approved: 'Approved',
  unpaid: 'Checkout Drop-off',
  pending: 'Checkout Drop-off',
  failed: 'Payment Failed',
  expired: 'Payment Expired',
};

export function getFollowUpStatusLabel(order: FailedOrder): string {
  if (order.oxygen_follow_up_status)
    return OXYGEN_LABELS[order.oxygen_follow_up_status];

  const method = order.payment_method
    ?.trim()
    .toLowerCase()
    .replaceAll('-', '_');
  const methodDetail = METHOD_DETAIL_BY_STATUS[order.payment_status];
  const methodLabel =
    methodDetail && method ? METHOD_LABELS.get(method) : undefined;
  let detail =
    (methodLabel && methodDetail) ??
    PAYMENT_LABELS[order.payment_status] ??
    'Payment status unavailable';
  const message = order.gateway_response?.message;
  if (order.attempt_count > 1) detail = `${order.attempt_count} attempts`;
  else if (typeof message === 'string' && message.trim()) detail = message;

  return methodLabel ? `${methodLabel} · ${detail}` : detail;
}
