import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDispatchMerchantSnapshot,
  buildDispatchPaymentSnapshot,
} from '@/lib/build-manual-order-document-dispatch-snapshot';
import { checkManualDocumentDispatchLease } from '@/lib/check-manual-document-dispatch-lease';
import {
  buildReceiptClaimUrl,
  createReceiptClaimToken,
  isSafeClaimDomain,
} from '@/lib/import-notifications/receipt-claim-links';
import { isSafeClaimSlug } from '@/lib/import-notifications/receipt-claim-slug';
import { selectInvoicePaymentAccountForRows } from '@/lib/invoice-payment-account';
import { buildManualOrderDocumentEmailContent } from '@/lib/manual-order-document-email';
import { persistManualDocumentDispatch } from '@/lib/mark-manual-document-dispatch-started';
import {
  resolveNotificationReplyTo,
  resolveOrderNotificationRecipient,
} from '@/lib/order-notification-recipient';
import { prepareManualDocumentClaim } from '@/lib/prepare-manual-document-claim';
import {
  ManualDocumentValidationError,
  renderManualOrderDocumentPdf,
} from '@/lib/render-manual-order-document-pdf';
import { reportFailedManualDocumentSend } from '@/lib/report-failed-manual-document-send';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { sanitizeEmailDisplayName } from '@/lib/sanitize-core';
import { sendEmail } from '@/lib/zeptomail';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

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
  | { status: 'sent'; messageId?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; deliveryOutcome?: 'unknown' };

type ManualDocumentSnapshot = {
  order: unknown;
  merchant: unknown;
  tax_subtotals: unknown[];
  transactions: unknown[];
  payment_accounts: unknown[];
  claim_domain: string | null;
};

// Only a CRON_SECRET-authenticated outbox worker calls this helper. No customer
// request constructs a privileged client or chooses the recipient/tenant.
// The worker's service-role client touches no table directly here: one
// claim-bound snapshot RPC returns the exact projections the render,
// validate, and snapshot path consumes, and every helper below selects
// from those rows in memory.
export async function sendManualOrderDocument({
  supabase,
  row,
}: {
  supabase: SupabaseClient;
  row: DocumentRow;
}): Promise<ManualOrderDocumentResult> {
  const { data: snapshotData, error: snapshotError } = await supabase.rpc(
    'get_manual_order_document_snapshot',
    { p_outbox_id: row.id, p_claim_owner: row.claim_owner }
  );
  if (snapshotError) throw new Error('Manual document data unavailable');
  // A re-arm stole the claim between claim and send: fail for a bounded
  // retry (the row is pending again) instead of emailing from a snapshot
  // the worker no longer owns.
  if (!snapshotData)
    return { status: 'failed', error: 'dispatch_claim_superseded' };
  const snapshot = snapshotData as unknown as ManualDocumentSnapshot;
  if (!snapshot.order || !snapshot.merchant)
    return { status: 'skipped', reason: 'order_or_merchant_missing' };
  // Deterministic shape failures skip (later triggers re-arm) instead of
  // throwing into max_attempts retries; only transient fetch/RPC failures
  // keep throw/retry.
  const orderParsed = manualDocumentOrderSchema.safeParse(snapshot.order);
  if (!orderParsed.success)
    return { status: 'skipped', reason: 'order_validation_failed' };
  const merchantParsed = manualDocumentMerchantSchema.safeParse(
    snapshot.merchant
  );
  if (!merchantParsed.success)
    return { status: 'skipped', reason: 'merchant_validation_failed' };
  const order = orderParsed.data;
  const merchant = merchantParsed.data;
  const rawMerchantRegisteredAddress = (
    snapshot.merchant as { registered_address?: unknown }
  ).registered_address;
  const rawMerchantBrandColors = (
    snapshot.merchant as { brand_colors?: unknown }
  ).brand_colors;
  // No DB constraint on either status column: normalize legacy spellings
  // exactly like the enqueue trigger so both agree on terminal/paid/eligible.
  const paymentStatus = order.payment_status
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (
    order.merchant_id !== row.merchant_id ||
    merchant.id !== row.merchant_id ||
    !order.recorded_by_user_id ||
    order.import_job_id ||
    order.external_source?.trim() ||
    ['cancelled', 'canceled', 'returned', 'failed'].includes(
      order.shipping_status.trim().toLowerCase()
    ) ||
    !['paid', 'unpaid', 'pending', 'partially_paid'].includes(paymentStatus)
  ) {
    return { status: 'skipped', reason: 'ineligible_manual_order' };
  }
  const recipient = resolveOrderNotificationRecipient(order.customer_email);
  if (!recipient.ok) return { status: 'skipped', reason: recipient.reason };
  if (!order.customer_id)
    return { status: 'skipped', reason: 'missing_customer' };
  if (!order.order_items.length)
    return { status: 'skipped', reason: 'missing_order_items' };
  // A fully-covered balance is substantively paid even under a non-paid
  // label: mirror the trigger so settled orders render receipts.
  const isPaid = paymentStatus === 'paid' || order.amount_paid >= order.total;
  const documentKind = isPaid ? 'receipt' : 'invoice';
  if ((row.event_type === 'manual_order_receipt') !== isPaid)
    return { status: 'skipped', reason: 'document_state_changed' };
  if (isPaid && order.amount_paid < order.total)
    return { status: 'skipped', reason: 'paid_balance_outstanding' };
  // Invoice-method orders render as proforma (Peppol 325) like the
  // account view, so the emailed document agrees with it.
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
  // Attach the assigned virtual account so instructions name the exact account.
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
  // Staff-recorded orders may omit the customer name; fall back instead of
  // throwing. The name is header-adjacent (toName): strip line breaks.
  const displayCustomerName = sanitizeEmailDisplayName(
    order.customer_name || 'there'
  );
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
    });
  } catch (error) {
    // Deterministic shape failures skip (later triggers re-arm) instead of
    // throwing into max_attempts retries — same contract as the order and
    // merchant schema failures above.
    if (error instanceof ManualDocumentValidationError) {
      return { status: 'skipped', reason: error.reason };
    }
    throw error;
  }
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
  // The slug supplies the claim host only when no safe custom domain
  // wins (mirroring buildReceiptClaimUrl's normalization): an unsafe
  // legacy slug skips only on the fallback path, never when the custom
  // domain resolves.
  const customDomainHost = customDomain
    ?.trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.$/, '');
  if (
    !(customDomainHost && isSafeClaimDomain(customDomainHost)) &&
    !isSafeClaimSlug(merchant.slug)
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
  let providerAccepted = false;
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
  }
  try {
    const result = await sendEmail({
      ...content,
      to: recipient.email,
      toName: displayCustomerName,
      attachments: [
        {
          name: `${pdfDocumentKind}-${order.order_number.replace(/[^\w.-]/g, '_')}.pdf`,
          content: Buffer.from(pdf.output('arraybuffer')).toString('base64'),
          mime_type: 'application/pdf',
        },
      ],
      emailType: 'orders',
      fromName: sanitizeEmailDisplayName(
        merchant.email_sender_name ||
          merchant.business_name ||
          merchant.slug ||
          ''
      ),
      // merchant.email is the private login address: never a reply target.
      replyTo: resolveNotificationReplyTo(merchant.support_email),
      clientReference: `order:${order.id}:${row.event_type}`,
      beforeTransportDispatch: () => persistDispatch(true),
      resetTransportDispatch: () => persistDispatch(false),
      auditContext: {
        merchantId: row.merchant_id,
        orderId: order.id,
        customerId: order.customer_id,
        metadata: { trigger: row.event_type, outbox_id: row.id },
      },
    });
    if (!result.success) {
      return reportFailedManualDocumentSend(result, () =>
        persistDispatch(false)
      );
    }
    providerAccepted = true;
    // A data change reset the marker after dispatch: the PDF is stale,
    // so fail for a bounded corrective retry instead of recording sent.
    const lease = await checkManualDocumentDispatchLease(supabase, row.id);
    if (lease === 'unknown')
      return {
        status: 'failed',
        error: 'dispatch_lease_check_failed',
        deliveryOutcome: 'unknown',
      };
    if (lease === 'reset')
      return { status: 'failed', error: 'document_changed_during_send' };
    const { data: markedClaimId, error: markError } = await supabase.rpc(
      'mark_manual_document_claim_sent',
      { p_claim_id: prepared.claim_id, p_merchant_id: row.merchant_id }
    );
    if (markError || markedClaimId !== prepared.claim_id)
      return {
        status: 'failed',
        error: 'sent_claim_marker_failed',
        deliveryOutcome: 'unknown',
      };
    return { status: 'sent', messageId: result.messageId };
  } catch (error) {
    // Never re-dispatch after a lost provider response or an accepted send whose
    // database marker could not be persisted. Tokens/PDFs are not logged here.
    if (dispatchStarted || providerAccepted)
      return {
        status: 'failed',
        error: 'document_delivery_outcome_unknown',
        deliveryOutcome: 'unknown',
      };
    throw error;
  }
}
