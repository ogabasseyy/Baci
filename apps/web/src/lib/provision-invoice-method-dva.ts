import type { ReceiptOrder } from '@baci/shared';
import type { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { generatePaymentAccount } from '@/lib/paystack';

// The pre-response Pay for Me call holds the order-creation POST after
// the order has committed: bound the provider leg so a stalled Paystack
// request throws (and the caller falls back to post-response
// provisioning) instead of hanging the response until the client times
// out. Persistence stays outside the deadline — Supabase carries its
// own client timeouts, and a timed-out provider must never persist.
const DVA_PROVIDER_TIMEOUT_MS = 10_000;

async function withProviderDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Paystack DVA provider request timed out'));
      }, DVA_PROVIDER_TIMEOUT_MS);
      work.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface DvaAssignmentPersistenceInput {
  accountName: string;
  accountNumber: string;
  bankName: string;
  customerEmail: string;
  expiresAt: string;
  orderId: string;
}

interface ProvisionInvoiceMethodDvaInput {
  persistAssignment: (
    assignment: DvaAssignmentPersistenceInput
  ) => Promise<NextResponse | null>;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  merchantPhone: string | null;
  orderId: string;
  // Pre-resolved DVA expiry: the invoice caller shares its timing here so
  // the expiry and the PDF due date derive from the identical instant (no
  // "two nows" drift).
  expiresAt: string;
  orderCurrency: string;
  /** Invoice keeps its exact legacy log messages; payforme logs its own. */
  orderLabel: 'invoice' | 'payforme';
}

/**
 * Provisions a Paystack DVA for an invoice-method order (invoice or Pay
 * for Me) and persists the assignment. Throws propagate to the caller so
 * the email catch can still render with the pre-derived credited
 * balance; provisioning failures and persistence failures log and
 * return null (merchant-contact fallback). Persistence is injected by
 * the caller (a closure over its own persistPaystackDvaAssignment edge
 * with the appropriate client: admin for invoice, request-scoped for
 * Pay for Me): this module never imports the persistence chain itself,
 * so it introduces no new service-role credential edge.
 */
export async function provisionInvoiceMethodDva({
  persistAssignment,
  customerEmail,
  customerName,
  customerPhone,
  merchantPhone,
  orderId,
  expiresAt,
  orderCurrency,
  orderLabel,
}: ProvisionInvoiceMethodDvaInput): Promise<ReceiptOrder['virtual_account']> {
  const nameParts = (customerName || 'Customer').trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || 'User';

  // Paystack DVAs settle in NGN only: provisioning for a
  // foreign-currency quote would print a naira account beside
  // a dollar amount and risk a rejected transfer, so non-NGN
  // orders skip provisioning (null result) and fall
  // through to merchant-contact instructions.
  const dvaResult =
    orderCurrency === 'NGN'
      ? await withProviderDeadline(
          generatePaymentAccount({
            email: customerEmail || `${orderId}@orders.usebaci.com`,
            firstName,
            lastName,
            phone: customerPhone || merchantPhone || '08000000000',
            orderId,
          })
        )
      : null;

  if (dvaResult?.success) {
    const generatedVirtualAccount = {
      account_number: dvaResult.data.account_number,
      bank_name: dvaResult.data.bank_name,
      account_name: dvaResult.data.account_name,
    };

    const persistenceFailure = await persistAssignment({
      accountName: dvaResult.data.account_name,
      accountNumber: dvaResult.data.account_number,
      bankName: dvaResult.data.bank_name,
      customerEmail: customerEmail || `${orderId}@orders.usebaci.com`,
      expiresAt,
      orderId,
    });

    if (persistenceFailure) {
      logger.error({
        message:
          orderLabel === 'invoice'
            ? 'Failed to store auto-generated invoice DVA'
            : 'Failed to store auto-generated payforme DVA',
        orderId,
      });
      return null;
    }
    logger.info({
      message:
        orderLabel === 'invoice'
          ? 'Stored auto-generated invoice DVA successfully'
          : 'Stored auto-generated payforme DVA successfully',
      orderId,
      accountNumber: dvaResult.data.account_number,
    });
    return generatedVirtualAccount;
  }
  if (dvaResult) {
    logger.error({
      message:
        orderLabel === 'invoice'
          ? 'Auto-generation of invoice DVA failed'
          : 'Auto-generation of payforme DVA failed',
      orderId,
      error: dvaResult.error,
    });
  }
  return null;
}
