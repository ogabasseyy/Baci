import type { DvaMatchCandidate } from '@/lib/payments/paystack-dva-multi-key-match';

export function normalizePaystackDvaOrderCandidate(
  row: Record<string, unknown>
): DvaMatchCandidate | null {
  const orderField = row.orders;
  if (!orderField || typeof orderField !== 'object') return null;

  const order = orderField as Record<string, unknown>;
  if (
    order.payment_status !== 'pending' &&
    order.payment_status !== 'unpaid' &&
    order.payment_status !== 'partially_paid'
  ) {
    return null;
  }
  if (
    order.shipping_status === 'cancelled' ||
    order.shipping_status === 'canceled'
  ) {
    return null;
  }

  const total = Number(order.total);
  if (!Number.isFinite(total)) return null;
  const amountPaid = Number(order.amount_paid ?? 0);
  if (!Number.isFinite(amountPaid)) return null;
  const payableAmount =
    row.payable_amount == null ? null : Number(row.payable_amount);
  const normalizedPayableAmount =
    payableAmount != null && Number.isFinite(payableAmount)
      ? payableAmount
      : null;
  const merchantCreated =
    typeof order.recorded_by_user_id === 'string' &&
    order.recorded_by_user_id.trim().length > 0;
  const createdAt =
    typeof row.created_at === 'string' ? new Date(row.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;

  const assignedAt =
    typeof row.assigned_at === 'string' ? new Date(row.assigned_at) : null;
  const validAssignedAt =
    assignedAt && !Number.isNaN(assignedAt.getTime()) ? assignedAt : null;
  const orderRemainingAmount = Math.max(total - amountPaid, 0);
  // Merchant-created invoices keep their assignment-time payable snapshot so
  // a delayed transfer can still be attributed to the invoice. Storefront
  // orders, however, can receive a manual or wallet payment after DVA
  // assignment; cap their expected amount at the current order remainder so a
  // stale snapshot cannot accept an old total or reject the new remainder.
  const outstandingAmount =
    normalizedPayableAmount == null
      ? orderRemainingAmount
      : merchantCreated
        ? normalizedPayableAmount
        : Math.min(normalizedPayableAmount, orderRemainingAmount);
  const expiresAt =
    typeof row.expires_at === 'string' ? new Date(row.expires_at) : null;
  // The legacy cleanup deliberately clears unverifiable assignment snapshots.
  // Never fall back to the mutable order email for those aliases: doing so
  // could match a delayed transfer to the wrong customer after an email edit.
  if (row.assignment_customer_email_source === 'legacy_untrusted') {
    return null;
  }
  return {
    order_id: String(row.order_id),
    merchant_id: String(order.merchant_id ?? ''),
    merchant_created: merchantCreated,
    payment_status: order.payment_status,
    customer_email:
      typeof row.assignment_customer_email === 'string'
        ? row.assignment_customer_email
        : typeof order.customer_email === 'string'
          ? order.customer_email
          : null,
    total_kobo: toPaystackKobo(total),
    payable_amount_kobo:
      normalizedPayableAmount != null
        ? toPaystackKobo(normalizedPayableAmount)
        : null,
    outstanding_amount_kobo: toPaystackKobo(outstandingAmount),
    account_created_at: createdAt,
    account_assigned_at: validAssignedAt,
    account_expires_at:
      expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
  };
}

export function getPaystackDvaOrderCurrency(
  rows: unknown[],
  orderId: string
): string | null {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const candidate = row as Record<string, unknown>;
    if (
      candidate.order_id === orderId &&
      candidate.orders &&
      typeof candidate.orders === 'object'
    ) {
      const order = candidate.orders as Record<string, unknown>;
      if (typeof order.currency === 'string') return order.currency;
    }
  }
  return null;
}

export function toPaystackKobo(amountNgn: number): number {
  return Math.round(amountNgn * 100);
}

export function getPaystackCustomerName(
  customer: Record<string, unknown> | null
): string | null {
  const firstName =
    typeof customer?.first_name === 'string' ? customer.first_name.trim() : '';
  const lastName =
    typeof customer?.last_name === 'string' ? customer.last_name.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || null;
}
