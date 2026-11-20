import { PAYMENT_METHOD_SETTING_DEFINITIONS } from '@baci/shared';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import type { OxygenFollowUpStatus } from '@/schemas/oxygen-follow-up';

const OXYGEN_LABELS: Record<OxygenFollowUpStatus, string> = {
  customer_action: 'Oxygen · Customer needs to continue',
  oxygen_processing: 'Oxygen · Processing',
  approved_pending: 'Oxygen · Approved, action pending',
  needs_review: 'Oxygen · Review needed',
};

const CHECKOUT_DROP_OFF = 'Checkout Drop-off';

const PAYMENT_LABELS: Record<string, string> = {
  bnpl_pending: 'BNPL Drop-off',
  bnpl_approved: 'BNPL Approved',
  failed: 'Payment Failed',
  pending: CHECKOUT_DROP_OFF,
  expired: 'Payment Expired',
  unpaid: CHECKOUT_DROP_OFF,
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  unknown: 'Payment status unavailable',
};

export const RETAINED_PAYMENT_STATUSES = [
  'bnpl_approved',
  'paid',
  'refunded',
  'cancelled',
] as const;

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
  unpaid: CHECKOUT_DROP_OFF,
  pending: CHECKOUT_DROP_OFF,
  failed: 'Payment Failed',
  expired: 'Payment Expired',
};

function getMethodLabel(order: FailedOrder): string | undefined {
  const method = order.payment_method
    ?.trim()
    .toLowerCase()
    .replaceAll('-', '_');
  return METHOD_DETAIL_BY_STATUS[order.payment_status] && method
    ? METHOD_LABELS.get(method)
    : undefined;
}

export function getFollowUpStatusLabel(order: FailedOrder): string {
  const methodLabel = getMethodLabel(order);
  if (order.staff_follow_up_only) {
    const status = RETAINED_PAYMENT_STATUSES.find(
      (status) => status === order.payment_status
    );
    const retained = status
      ? `Staff follow-up · ${PAYMENT_LABELS[status]}`
      : 'Staff follow-up';
    return status && methodLabel ? `${methodLabel} · ${retained}` : retained;
  }
  if (order.oxygen_follow_up_status)
    return OXYGEN_LABELS[order.oxygen_follow_up_status];

  const methodDetail = METHOD_DETAIL_BY_STATUS[order.payment_status];
  let detail =
    (methodLabel && methodDetail) ??
    PAYMENT_LABELS[order.payment_status] ??
    'Payment status unavailable';
  const message = order.gateway_response?.message;
  if (order.attempt_count > 1) detail = `${order.attempt_count} attempts`;
  else if (typeof message === 'string' && message.trim()) detail = message;

  return methodLabel ? `${methodLabel} · ${detail}` : detail;
}
