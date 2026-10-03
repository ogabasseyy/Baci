import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDispatchMerchantSnapshot,
  buildDispatchPaymentSnapshot,
} from '@/lib/build-manual-order-document-dispatch-snapshot';
import { checkManualDocumentDispatchLease } from '@/lib/check-manual-document-dispatch-lease';
import { buildReceiptClaimUrl } from '@/lib/import-notifications/receipt-claim-links';
import { resolveInvoicePaymentAccount } from '@/lib/invoice-payment-account';
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

// Only a CRON_SECRET-authenticated outbox worker calls this helper. No customer
// request constructs a privileged client or chooses the recipient/tenant.
export async function sendManualOrderDocument({
  supabase,
  row,
}: {
  supabase: SupabaseClient;
  row: DocumentRow;
}): Promise<ManualOrderDocumentResult> {
  const [orderResult, merchantResult] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, merchant_id, customer_id, recorded_by_user_id, import_job_id, external_source, order_number, created_at, transaction_date, invoice_issue_date, currency, total, subtotal, shipping_fee, tax_amount, discount_amount, amount_paid, payment_status, payment_method, shipping_status, customer_name, customer_email, customer_phone, shipping_address, invoice_type_code, invoice_note, payment_due_date, payment_terms, buyer_reference, firs_irn, firs_csid, notes, order_items(id, line_id, name, quantity, price, variant_name, condition, item_description, assurance_fee, unit_code, line_extension_amount, vat_category_code, vat_rate, vat_amount, sellers_item_id)'
      )
      .eq('id', row.order_id)
      .eq('merchant_id', row.merchant_id)
      .maybeSingle(),
    supabase
      .from('merchants')
      .select(
        'id, slug, business_name, email_sender_name, logo_url, email, phone, support_email, support_phone, business_address, registered_address, cac_rc_number, tax_identification_number, legal_entity_name, vat_registration_status, vat_rate, bank_code, bank_account_number, bank_name, bank_account_name, brand_colors'
      )
      .eq('id', row.merchant_id)
      .maybeSingle(),
  ]);
  if (orderResult.error || merchantResult.error)
    throw new Error('Manual document data unavailable');
  if (!orderResult.data || !merchantResult.data)
    return { status: 'skipped', reason: 'order_or_merchant_missing' };
  // Deterministic shape failures skip (later triggers re-arm) instead of
  // throwing into max_attempts retries; only transient fetch/RPC failures
  // keep throw/retry.
  const orderParsed = manualDocumentOrderSchema.safeParse(orderResult.data);
  if (!orderParsed.success)
    return { status: 'skipped', reason: 'order_validation_failed' };
  const merchantParsed = manualDocumentMerchantSchema.safeParse(
    merchantResult.data
  );
  if (!merchantParsed.success)
    return { status: 'skipped', reason: 'merchant_validation_failed' };
  const order = orderParsed.data;
  const merchant = merchantParsed.data;
  const rawMerchantRegisteredAddress = merchantResult.data.registered_address;
  const rawMerchantBrandColors = merchantResult.data.brand_colors;
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
  const invoicePaymentAccount = isPaid
    ? null
    : await resolveInvoicePaymentAccount(supabase, order.id, false);
  if (invoicePaymentAccount?.error) {
    throw new Error('Manual document payment account unavailable');
  }
  const preferredPaymentAccount = invoicePaymentAccount?.paymentAccount ?? null;
  // Staff-recorded orders may omit the customer name; fall back instead of
  // throwing. The name is header-adjacent (toName): strip line breaks.
  const displayCustomerName = sanitizeEmailDisplayName(
    order.customer_name || 'there'
  );
  let rendered: Awaited<ReturnType<typeof renderManualOrderDocumentPdf>>;
  try {
    rendered = await renderManualOrderDocumentPdf({
      supabase,
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
  });
  if (claimStep.status === 'skipped') return claimStep;
  const { prepared, claim, customDomain } = claimStep;
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
      buildDispatchPaymentSnapshot(merchant, preferredPaymentAccount),
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
      // A definite rejection never reached the customer: clear the marker so
      // the bounded retry re-claims cleanly. Unknown outcomes keep the marker.
      if (result.deliveryOutcome !== 'unknown') {
        // Inline clear retries + worker reclaim precede the next claim, so retries re-send.
        try {
          await persistDispatch(false);
        } catch {
          return { status: 'failed', error: 'dispatch_marker_clear_failed' };
        }
      }
      return {
        status: 'failed',
        error: result.error || 'Document email failed',
        ...(result.deliveryOutcome === 'unknown'
          ? { deliveryOutcome: 'unknown' as const }
          : {}),
      };
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
    const { data: marked, error: markError } = await supabase
      .from('receipt_claims')
      .update({ notification_sent_at: new Date().toISOString() })
      .match({ id: prepared.claim_id, merchant_id: row.merchant_id })
      .select('id')
      .maybeSingle();
    if (markError || marked?.id !== prepared.claim_id)
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
