import type { SupabaseClient } from '@supabase/supabase-js';
import { createReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';
import { resolveInvoicePaymentAccount } from '@/lib/invoice-payment-account';
import { buildManualOrderDocumentEmailContent } from '@/lib/manual-order-document-email';
import { markManualDocumentDispatchStarted } from '@/lib/mark-manual-document-dispatch-started';
import { resolveOrderNotificationRecipient } from '@/lib/order-notification-recipient';
import { renderManualOrderDocumentPdf } from '@/lib/render-manual-order-document-pdf';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { resolveManualDocumentClaimDomain } from '@/lib/resolve-manual-document-claim-domain';
import { sendEmail } from '@/lib/zeptomail';
import {
  assertManualDocumentClaimMatchesOrder,
  manualDocumentClaimSchema,
} from '@/schemas/manual-order-document-claim';
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
        'id, merchant_id, customer_id, recorded_by_user_id, import_job_id, external_source, order_number, created_at, transaction_date, invoice_issue_date, currency, total, subtotal, shipping_fee, tax_amount, discount_amount, amount_paid, payment_status, payment_method, shipping_status, customer_name, customer_email, customer_phone, shipping_address, invoice_type_code, invoice_note, notes, order_items(id, name, quantity, price, variant_name, condition, item_description)'
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
  // Deterministic shape failures skip (order-side fixes re-arm via a later
  // trigger; the merchant schema stays lenient on cosmetic JSONB for the
  // same reason) instead of throwing into max_attempts retries; only
  // transient fetch errors above and RPC failures below keep throw/retry.
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
  if (
    order.merchant_id !== row.merchant_id ||
    merchant.id !== row.merchant_id ||
    !order.recorded_by_user_id ||
    order.import_job_id ||
    order.external_source ||
    ['cancelled', 'canceled', 'returned', 'failed'].includes(
      order.shipping_status
    ) ||
    !['paid', 'unpaid', 'pending', 'partially_paid'].includes(
      order.payment_status
    )
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
  // label (e.g. an over-amount partial): mirror the trigger so a settled
  // order renders a receipt, never a zero-balance invoice.
  const isPaid =
    order.payment_status === 'paid' || order.amount_paid >= order.total;
  const documentKind = isPaid ? 'receipt' : 'invoice';
  if ((row.event_type === 'manual_order_receipt') !== isPaid)
    return { status: 'skipped', reason: 'document_state_changed' };
  if (isPaid && order.amount_paid < order.total)
    return { status: 'skipped', reason: 'paid_balance_outstanding' };
  // Match the canonical invoice surfaces: invoice-method orders render as
  // proforma (Peppol type 325) so the emailed document agrees with the
  // customer's account view.
  const invoiceTypeCode = isPaid
    ? null
    : resolveInvoiceTypeCode({
        paymentMethod: order.payment_method,
        isPaid,
        wasPaid: false,
        paymentStatus: order.payment_status,
        amountPaid: order.amount_paid,
        storedTypeCode: order.invoice_type_code,
      });
  const pdfDocumentKind =
    invoiceTypeCode === '325' ? 'proforma_invoice' : documentKind;
  // Attach the assigned virtual account so invoice payment instructions name
  // the exact account instead of generic merchant bank details.
  const invoicePaymentAccount = isPaid
    ? null
    : await resolveInvoicePaymentAccount(supabase, order.id, false);
  if (invoicePaymentAccount?.error) {
    throw new Error('Manual document payment account unavailable');
  }
  const preferredPaymentAccount = invoicePaymentAccount?.paymentAccount ?? null;
  // Staff-recorded orders may omit the customer name; greet with the import
  // sender's fallback instead of throwing through every retry.
  const displayCustomerName = order.customer_name || 'there';
  const pdf = await renderManualOrderDocumentPdf({
    supabase,
    order,
    merchant,
    recipientEmail: recipient.email,
    preferredPaymentAccount,
    isPaid,
    pdfDocumentKind,
    invoiceTypeCode,
  });
  const claim = createReceiptClaimToken();
  const { data, error } = await supabase.rpc(
    'create_manual_order_document_claim',
    {
      p_outbox_id: row.id,
      p_claim_owner: row.claim_owner,
      p_token_hash: claim.tokenHash,
    }
  );
  if (error) throw new Error('Could not prepare manual document access');
  const preparedParsed = manualDocumentClaimSchema.safeParse(data);
  if (!preparedParsed.success)
    return { status: 'skipped', reason: 'claim_validation_failed' };
  const prepared = preparedParsed.data;
  if (prepared.status !== 'created')
    return { status: 'skipped', reason: 'document_claim_unavailable' };
  assertManualDocumentClaimMatchesOrder(prepared, order, recipient.email);
  const customDomain = await resolveManualDocumentClaimDomain(
    supabase,
    row.merchant_id
  );
  const content = buildManualOrderDocumentEmailContent({
    order,
    merchant,
    recipientEmail: recipient.email,
    displayCustomerName,
    pdfDocumentKind,
    claimToken: claim.token,
    customDomain,
  });
  let dispatchStarted = false;
  let providerAccepted = false;
  async function persistDispatch(started: boolean) {
    // The atomic RPC already committed dispatch_started_at: a second
    // conditional write here would match zero rows and fail every send.
    if (started) {
      await markManualDocumentDispatchStarted(
        supabase,
        row,
        order,
        pdfDocumentKind,
        {
          merchantBankCode: merchant.bank_code,
          merchantBankAccountNumber: merchant.bank_account_number,
          merchantBankName: merchant.bank_name,
          merchantBankAccountName: merchant.bank_account_name,
          virtualAccountNumber: preferredPaymentAccount?.account_number ?? null,
          virtualAccountBankName: preferredPaymentAccount?.bank_name ?? null,
          virtualAccountName: preferredPaymentAccount?.account_name ?? null,
        }
      );
      dispatchStarted = true;
      return;
    }
    const { data: updated, error: updateError } = await supabase
      .from('order_notification_outbox')
      .update({ dispatch_started_at: null })
      .match({
        id: row.id,
        order_id: row.order_id,
        merchant_id: row.merchant_id,
        event_type: row.event_type,
        locked_by: row.claim_owner,
        status: 'processing',
      })
      .select('id')
      .maybeSingle();
    if (updateError || updated?.id !== row.id)
      throw new Error('Manual document dispatch lease lost');
    dispatchStarted = false;
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
      fromName:
        merchant.email_sender_name || merchant.business_name || merchant.slug,
      // merchant.email is the private login address: never a reply target.
      // Omitting replyTo lets the provider fall back to the sender identity.
      replyTo: merchant.support_email || undefined,
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
      // A definite rejection never reached the customer: clear the dispatch
      // marker so the bounded retry re-claims cleanly instead of skipping
      // forever on a stale marker. Unknown outcomes keep the marker to
      // preserve at-most-once delivery.
      if (result.deliveryOutcome !== 'unknown') await persistDispatch(false);
      return {
        status: 'failed',
        error: result.error || 'Document email failed',
        ...(result.deliveryOutcome === 'unknown'
          ? { deliveryOutcome: 'unknown' as const }
          : {}),
      };
    }
    providerAccepted = true;
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
