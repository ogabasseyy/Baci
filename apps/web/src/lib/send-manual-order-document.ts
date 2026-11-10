import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDispatchMerchantSnapshot,
  buildDispatchPaymentSnapshot,
} from '@/lib/build-manual-order-document-dispatch-snapshot';
import {
  checkManualDocumentDispatchLease,
  resetStartedDispatchMarker,
} from '@/lib/check-manual-document-dispatch-lease';
import {
  buildReceiptClaimUrl,
  createReceiptClaimToken,
  isSafeClaimDomain,
} from '@/lib/import-notifications/receipt-claim-links';
import { isSafeClaimSlug } from '@/lib/import-notifications/receipt-claim-slug';
import { selectInvoicePaymentAccountForRows } from '@/lib/invoice-payment-account';
import { loadManualDocumentDispatch } from '@/lib/load-manual-document-dispatch';
import {
  buildManualOrderDocumentEmailContent,
  resolveManualDocumentFromName,
} from '@/lib/manual-order-document-email';
import { persistManualDocumentDispatch } from '@/lib/mark-manual-document-dispatch-started';
import { resolveNotificationReplyTo } from '@/lib/order-notification-recipient';
import {
  prepareManualDocumentClaim,
  recordManualDocumentAcceptedToken,
} from '@/lib/prepare-manual-document-claim';
import {
  ManualDocumentValidationError,
  renderManualOrderDocumentPdf,
} from '@/lib/render-manual-order-document-pdf';
import { reportFailedManualDocumentSend } from '@/lib/report-failed-manual-document-send';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { sanitizeEmailDisplayName } from '@/lib/sanitize-core';
import { sendEmail } from '@/lib/zeptomail';
import {
  ZEPTOMAIL_SEND_CUTOFF_BUFFER_MS,
  zeptomailSendAdmissionBudgetMs,
} from '@/lib/zeptomail-send-budget';

const EMAIL_ATTEMPTS_PER_SENDER = 1;
const EMAIL_ADMISSION_MS = zeptomailSendAdmissionBudgetMs(
  EMAIL_ATTEMPTS_PER_SENDER
);

const DEFERRED = { status: 'deferred' } as const;

function emailFits(invocationDeadline: number) {
  return invocationDeadline - Date.now() > EMAIL_ADMISSION_MS;
}

export type ManualOrderDocumentEventType =
  | 'manual_order_receipt'
  | 'manual_order_invoice';
interface DocumentRow {
  id: string;
  claim_owner: string;
  merchant_id: string;
  order_id: string;
  event_type: ManualOrderDocumentEventType;
}
export type ManualOrderDocumentResult =
  | typeof DEFERRED
  | { status: 'sent'; messageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; deliveryOutcome?: 'unknown' };

// Only a CRON_SECRET-authenticated outbox worker calls this helper. No customer
// request constructs a privileged client or chooses the recipient/tenant.
export async function sendManualOrderDocument({
  supabase,
  row,
  invocationDeadline = Date.now() + 60_000,
}: {
  supabase: Pick<SupabaseClient, 'rpc' | 'from'>;
  row: DocumentRow;
  invocationDeadline?: number;
}): Promise<ManualOrderDocumentResult> {
  const loaded = await loadManualDocumentDispatch({ supabase, row });
  if (loaded.status !== 'ready') return loaded;
  const { order, merchant, snapshot, recipient, paymentStatus } = loaded;
  const rawMerchantRegisteredAddress = (
    snapshot.merchant as { registered_address?: unknown }
  ).registered_address;
  const rawMerchantBrandColors = (
    snapshot.merchant as { brand_colors?: unknown }
  ).brand_colors;
  const isPaid = paymentStatus === 'paid' || order.amount_paid >= order.total;
  const documentKind = isPaid ? 'receipt' : 'invoice';
  if ((row.event_type === 'manual_order_receipt') !== isPaid)
    return { status: 'skipped', reason: 'document_state_changed' };
  if (isPaid && order.amount_paid < order.total)
    return { status: 'skipped', reason: 'paid_balance_outstanding' };
  const invoiceTypeCode = isPaid
    ? null
    : resolveInvoiceTypeCode({
        paymentMethod: order.payment_method,
        isPaid,
        wasPaid: false,
        paymentStatus,
        amountPaid: order.amount_paid,
        storedTypeCode: order.invoice_type_code,
      });
  const pdfDocumentKind =
    invoiceTypeCode === '325' ? 'proforma_invoice' : documentKind;
  const preferredPaymentAccount = isPaid
    ? null
    : selectInvoicePaymentAccountForRows(
        snapshot.payment_accounts ?? [],
        (snapshot.transactions ?? []) as {
          created_at?: string | null;
          gateway?: string | null;
          metadata?: unknown;
          status?: string | null;
          transaction_type?: string | null;
        }[],
        false
      );
  const displayCustomerName = sanitizeEmailDisplayName(
    order.customer_name || 'there'
  );
  if (!emailFits(invocationDeadline)) return DEFERRED;
  let rendered: Awaited<ReturnType<typeof renderManualOrderDocumentPdf>>;
  try {
    rendered = await renderManualOrderDocumentPdf({
      taxRows: snapshot.tax_subtotals ?? [],
      transactionRows: snapshot.transactions ?? [],
      order,
      merchant,
      recipientEmail: recipient.email,
      preferredPaymentAccount,
      isPaid,
      pdfDocumentKind,
      invoiceTypeCode,
      renderDeadline: invocationDeadline - EMAIL_ADMISSION_MS,
    });
  } catch (error) {
    if (error instanceof ManualDocumentValidationError) {
      return { status: 'skipped', reason: error.reason };
    }
    if (!emailFits(invocationDeadline)) return DEFERRED;
    throw error;
  }
  if (!emailFits(invocationDeadline)) return DEFERRED;
  const { pdf, taxSubtotals, transactions } = rendered;
  const claimStep = await prepareManualDocumentClaim({
    supabase,
    row,
    order,
    recipientEmail: recipient.email,
    claim: createReceiptClaimToken(),
    claimDomain: snapshot.claim_domain ?? null,
  });
  if (claimStep.status === 'skipped') return claimStep;
  const { prepared, claim, customDomain } = claimStep;
  // Only the fallback claim host depends on the legacy slug.
  const customDomainHost = customDomain
    ?.trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.$/, '');
  const slugSuppliesHost =
    typeof merchant.slug === 'string' && isSafeClaimSlug(merchant.slug);
  if (
    !(customDomainHost && isSafeClaimDomain(customDomainHost)) &&
    !slugSuppliesHost
  ) {
    return { status: 'skipped', reason: 'merchant_validation_failed' };
  }
  const content = buildManualOrderDocumentEmailContent({
    order,
    merchant,
    recipientEmail: recipient.email,
    displayCustomerName,
    pdfDocumentKind,
    claimUrl: buildReceiptClaimUrl({
      merchant: { slug: merchant.slug, custom_domain: customDomain },
      token: claim.token,
    }),
  });
  let dispatchStarted = false;
  let attemptedTransport = false;
  let providerAccepted = false;
  let deferredBeforeTransport = false;
  async function persistDispatch(started: boolean) {
    await persistManualDocumentDispatch(
      supabase,
      row,
      order,
      pdfDocumentKind,
      buildDispatchPaymentSnapshot(
        merchant,
        preferredPaymentAccount,
        order,
        pdfDocumentKind
      ),
      taxSubtotals,
      transactions,
      buildDispatchMerchantSnapshot(
        merchant,
        rawMerchantRegisteredAddress,
        rawMerchantBrandColors
      ),
      customDomain,
      started
    );
    dispatchStarted = started;
    attemptedTransport ||= started;
  }
  try {
    const attachment = Buffer.from(await pdf.arrayBuffer()).toString('base64');
    if (!emailFits(invocationDeadline)) return DEFERRED;
    const transportDeadline =
      invocationDeadline - ZEPTOMAIL_SEND_CUTOFF_BUFFER_MS;
    const result = await sendEmail({
      ...content,
      to: recipient.email,
      toName: displayCustomerName,
      attachments: [
        {
          name: `${pdfDocumentKind}-${order.order_number.replace(/[^\w.-]/g, '_')}.pdf`,
          content: attachment,
          mime_type: 'application/pdf',
        },
      ],
      emailType: 'orders',
      maxAttemptsPerSender: EMAIL_ATTEMPTS_PER_SENDER,
      fallbackDeadlineMs: transportDeadline,
      signal: AbortSignal.timeout(transportDeadline - Date.now()),
      fromName: sanitizeEmailDisplayName(
        resolveManualDocumentFromName(merchant)
      ),
      // merchant.email is the private login address: never a reply target.
      replyTo: resolveNotificationReplyTo(merchant.support_email),
      clientReference: `order:${order.id}:${row.event_type}`,
      beforeTransportDispatch: () => {
        if (emailFits(invocationDeadline)) return persistDispatch(true);
        deferredBeforeTransport = !attemptedTransport;
        throw new Error('Manual document email transport budget exhausted');
      },
      resetTransportDispatch: () => persistDispatch(false),
      auditContext: {
        merchantId: row.merchant_id,
        orderId: order.id,
        customerId: order.customer_id,
        metadata: { trigger: row.event_type, outbox_id: row.id },
      },
    });
    if (!result.success) {
      if (deferredBeforeTransport) return DEFERRED;
      return reportFailedManualDocumentSend(result, () =>
        resetStartedDispatchMarker(dispatchStarted, persistDispatch)
      );
    }
    providerAccepted = true;
    const recordAcceptedToken = () =>
      recordManualDocumentAcceptedToken({
        supabase,
        claimId: prepared.claim_id,
        merchantId: row.merchant_id,
        mailedTokenHash: claim.tokenHash,
      });
    // A reset during transport requires a bounded corrective retry.
    const lease = await checkManualDocumentDispatchLease(
      supabase,
      row.id,
      row.claim_owner
    );
    if (!(await recordAcceptedToken()))
      return {
        status: 'failed',
        error: 'sent_claim_marker_failed',
        deliveryOutcome: 'unknown',
      };
    if (lease === 'unknown') {
      return {
        status: 'failed',
        error: 'dispatch_lease_check_failed',
        deliveryOutcome: 'unknown',
      };
    }
    if (lease === 'reset') {
      return { status: 'failed', error: 'document_changed_during_send' };
    }
    return { status: 'sent', messageId: result.messageId };
  } catch (error) {
    // Never re-dispatch after a lost provider response or an accepted send whose
    // database marker could not be persisted. Tokens/PDFs are not logged here.
    if (deferredBeforeTransport) return DEFERRED;
    if (dispatchStarted || providerAccepted)
      return {
        status: 'failed',
        error: 'document_delivery_outcome_unknown',
        deliveryOutcome: 'unknown',
      };
    throw error;
  }
}
