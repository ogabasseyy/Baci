import { type ReceiptOrder, showMerchantBankDetails } from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import {
  buildReceiptClaimUrl,
  createReceiptClaimToken,
} from '@/lib/import-notifications/receipt-claim-links';
import { resolveInvoicePaymentAccount } from '@/lib/invoice-payment-account';
import { buildManualOrderDocumentEmail } from '@/lib/manual-order-document-email';
import { resolveOrderNotificationRecipient } from '@/lib/order-notification-recipient';
import {
  generateReceiptPDF,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { sendEmail } from '@/lib/zeptomail';
import { manualDocumentClaimSchema } from '@/schemas/manual-order-document-claim';
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
        'id, merchant_id, customer_id, recorded_by_user_id, import_job_id, external_source, order_number, created_at, transaction_date, invoice_issue_date, currency, total, subtotal, shipping_fee, tax_amount, discount_amount, amount_paid, payment_status, payment_method, shipping_status, customer_name, customer_email, customer_phone, shipping_address, invoice_type_code, order_items(id, name, quantity, price, variant_name, condition)'
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
  const order = manualDocumentOrderSchema.parse(orderResult.data);
  const merchant = manualDocumentMerchantSchema.parse(merchantResult.data);
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
  const isPaid = order.payment_status === 'paid';
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
  // The persisted bank details are untyped naira accounts: hide them (and the
  // order-level virtual account the renderer prefers) on foreign-currency
  // documents so customers never wire dollars to a naira account.
  const showBankDetails = showMerchantBankDetails(order.currency || 'NGN');
  const receiptOrder: ReceiptOrder = {
    ...order,
    currency: order.currency || 'NGN',
    customer_email: recipient.email,
    amount_paid: order.amount_paid,
    balance: Math.max(0, order.total - order.amount_paid),
    virtual_account:
      showBankDetails && preferredPaymentAccount
        ? {
            account_number: preferredPaymentAccount.account_number,
            bank_name: preferredPaymentAccount.bank_name || '',
            account_name: preferredPaymentAccount.account_name || '',
          }
        : null,
    shipping_address: order.shipping_address
      ? {
          ...order.shipping_address,
          address_line1:
            order.shipping_address.address_line1 ||
            order.shipping_address.address,
        }
      : null,
    items: order.order_items.map((item) => ({
      ...item,
      product_name: item.name,
    })),
  };
  const receiptMerchant = {
    ...merchant,
    brand_colors: merchant.brand_colors ?? undefined,
    bank_code: showBankDetails ? merchant.bank_code : null,
    bank_account_number: showBankDetails ? merchant.bank_account_number : null,
    bank_name: showBankDetails ? merchant.bank_name : null,
    bank_account_name: showBankDetails ? merchant.bank_account_name : null,
  };
  // Later payments land in the transactions ledger without touching the
  // order's transaction date: date the receipt from the completing payment
  // when one exists, falling back to the recorded order dates.
  const paymentTransaction = isPaid
    ? await supabase
        .from('transactions')
        .select('created_at')
        .eq('order_id', order.id)
        .eq('transaction_type', 'payment')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  const receiptDate =
    paymentTransaction?.data?.created_at &&
    !paymentTransaction.error &&
    typeof paymentTransaction.data.created_at === 'string'
      ? paymentTransaction.data.created_at
      : null;
  const logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
  const pdf = generateReceiptPDF(receiptOrder, receiptMerchant, {
    documentKind: pdfDocumentKind,
    invoiceTypeCode,
    documentDate:
      (isPaid
        ? (receiptDate ?? order.transaction_date)
        : order.invoice_issue_date) || order.created_at,
    logoDataUri,
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
  const prepared = manualDocumentClaimSchema.parse(data);
  if (prepared.status !== 'created')
    return { status: 'skipped', reason: 'document_claim_unavailable' };
  if (
    prepared.customer_id !== order.customer_id ||
    prepared.customer_email.trim().toLowerCase() !== recipient.email
  ) {
    throw new Error('Manual document recipient changed');
  }
  // The claim RPC re-read the live order: abort (and retry with a fresh read)
  // when an edit landed between our read and the claim instead of dispatching
  // a document rendered from stale totals.
  if (
    prepared.order_total !== order.total ||
    prepared.order_amount_paid !== order.amount_paid ||
    prepared.order_item_count !== order.order_items.length ||
    prepared.order_payment_status !== order.payment_status
  ) {
    throw new Error('Manual document order changed during preparation');
  }
  // Custom domains live in public.domains, not on the merchant row: resolve
  // the active primary domain for a branded claim link, falling back to the
  // slug subdomain (which always routes) when none is assigned.
  const primaryDomain = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', row.merchant_id)
    .eq('is_primary', true)
    .eq('status', 'active')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(1)
    .maybeSingle();
  const customDomain =
    !primaryDomain.error &&
    primaryDomain.data &&
    typeof primaryDomain.data.domain === 'string'
      ? primaryDomain.data.domain
      : null;
  const content = buildManualOrderDocumentEmail({
    merchantName: merchant.business_name || merchant.slug,
    customerName: order.customer_name,
    customerEmail: recipient.email,
    orderNumber: order.order_number,
    documentKind: pdfDocumentKind,
    claimUrl: buildReceiptClaimUrl({
      merchant: { slug: merchant.slug, custom_domain: customDomain },
      token: claim.token,
    }),
    devices: order.order_items.map(
      (item) =>
        `${item.quantity > 1 ? `${item.quantity} x ` : ''}${item.name}${item.variant_name ? ` (${item.variant_name})` : ''}`
    ),
    brandColor: merchant.brand_colors?.primary,
    supportEmail: merchant.support_email || merchant.email,
    appLinks:
      merchant.slug === 'ogabassey'
        ? {
            appStoreUrl: OGABASSEY_STOREFRONT_APP_STORE_URL,
            playStoreUrl: OGABASSEY_STOREFRONT_PLAY_STORE_URL,
          }
        : null,
  });
  let dispatchStarted = false;
  let providerAccepted = false;
  async function persistDispatch(started: boolean) {
    const query = supabase
      .from('order_notification_outbox')
      .update({
        dispatch_started_at: started ? new Date().toISOString() : null,
      })
      .match({
        id: row.id,
        order_id: row.order_id,
        merchant_id: row.merchant_id,
        event_type: row.event_type,
        locked_by: row.claim_owner,
        status: 'processing',
      });
    const { data: updated, error: updateError } = await (started
      ? query.is('dispatch_started_at', null)
      : query
    )
      .select('id')
      .maybeSingle();
    if (updateError || updated?.id !== row.id)
      throw new Error('Manual document dispatch lease lost');
    dispatchStarted = started;
  }
  try {
    const result = await sendEmail({
      ...content,
      to: recipient.email,
      toName: order.customer_name,
      attachments: [
        {
          name: `${documentKind}-${order.order_number.replace(/[^\w.-]/g, '_')}.pdf`,
          content: Buffer.from(pdf.output('arraybuffer')).toString('base64'),
          mime_type: 'application/pdf',
        },
      ],
      emailType: 'orders',
      fromName:
        merchant.email_sender_name || merchant.business_name || merchant.slug,
      replyTo: merchant.support_email || merchant.email,
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
    if (!result.success)
      return {
        status: 'failed',
        error: result.error || 'Document email failed',
        ...(result.deliveryOutcome === 'unknown'
          ? { deliveryOutcome: 'unknown' as const }
          : {}),
      };
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
