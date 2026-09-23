import type { ReceiptOrder } from '@baci/shared';
import { logger } from '@/lib/logger';
import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import { provisionInvoiceMethodDva } from '@/lib/provision-invoice-method-dva';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './invoice-credit';
import type {
  ImmediateOrderNotificationContext,
  PreResponsePayformeProvisioning,
} from './notification-context';
import { getImmediateInvoiceDueDate } from './order-item-primitives';

export async function provisionPreResponsePayformeDva(
  ctx: ImmediateOrderNotificationContext
): Promise<PreResponsePayformeProvisioning> {
  const { order, supabase } = ctx;
  const creditedPaid = getCreditedAmountPaid(
    order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  if (
    ctx.effectivePaymentMethod !== 'payforme' ||
    ctx.idempotencyReplayed ||
    getImmediateEmailAmountDue(ctx.orderTotal, creditedPaid) <= 0
  ) {
    return { virtualAccount: null, attempted: false };
  }
  try {
    const preResponseOutcome = await provisionInvoiceMethodDva({
      persistAssignment: (assignment) =>
        persistPaystackDvaAssignment(supabase, assignment),
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      customerPhone: ctx.customerPhone ?? null,
      merchantPhone: ctx.merchant.phone ?? null,
      orderId: order.id,
      expiresAt: getImmediateInvoiceDueDate(
        order as Record<string, unknown>
      ).toISOString(),
      orderCurrency: ctx.orderCurrency,
      orderLabel: 'payforme',
    });
    if (preResponseOutcome.outcome === 'provisioned') {
      return {
        virtualAccount: preResponseOutcome.virtualAccount,
        attempted: true,
      };
    }
    if (preResponseOutcome.outcome === 'failed') {
      // Retryable provider failure (handled error or deadline): allow
      // the in-after branch one retry so the request email can still
      // carry transfer details. Definitive skips and uncertain
      // persistence stay suppressed.
      return { virtualAccount: null, attempted: false };
    }
    return { virtualAccount: null, attempted: true };
  } catch (error) {
    // Unexpected failure (not a discriminated outcome): allow the
    // in-after branch one retry so the request email can still carry
    // transfer details.
    logger.error({
      message:
        'Pre-response Pay for Me DVA provisioning threw; will retry post-response',
      orderId: order.id,
      error: error instanceof Error ? error.message : error,
    });
    return { virtualAccount: null, attempted: false };
  }
}

export async function provisionPayformeRetryDva(
  ctx: ImmediateOrderNotificationContext,
  preResponse: PreResponsePayformeProvisioning
): Promise<ReceiptOrder['virtual_account']> {
  const { order, supabase } = ctx;
  const creditedPaid = getCreditedAmountPaid(
    order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  if (
    ctx.effectivePaymentMethod !== 'payforme' ||
    getImmediateEmailAmountDue(ctx.orderTotal, creditedPaid) <= 0
  ) {
    return null;
  }
  if (preResponse.virtualAccount) {
    // Pre-response provisioning already persisted the DVA the success
    // page looked up: reuse it, never provision a second account for
    // the same order.
    return preResponse.virtualAccount;
  }
  if (preResponse.attempted) {
    // The pre-response attempt ran and yielded nothing (non-NGN skip or
    // Paystack/persistence failure, already logged) — no retry, since a
    // second Paystack call cannot fix a definitive skip and would orphan
    // a second virtual account on persistence failure.
    return null;
  }
  try {
    const retryOutcome = await provisionInvoiceMethodDva({
      persistAssignment: (assignment) =>
        persistPaystackDvaAssignment(supabase, assignment),
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      customerPhone: ctx.customerPhone ?? null,
      merchantPhone: ctx.merchant.phone ?? null,
      orderId: order.id,
      expiresAt: getImmediateInvoiceDueDate(
        order as Record<string, unknown>
      ).toISOString(),
      orderCurrency: ctx.orderCurrency,
      orderLabel: 'payforme',
    });
    return retryOutcome.outcome === 'provisioned'
      ? retryOutcome.virtualAccount
      : null;
  } catch (error) {
    logger.error({
      message:
        'Failed to provision Pay for Me DVA; sending request email without transfer details',
      orderId: order.id,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
