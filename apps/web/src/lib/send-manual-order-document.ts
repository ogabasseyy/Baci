import type { ReceiptOrder } from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import {
  buildReceiptClaimUrl,
  createReceiptClaimToken,
} from '@/lib/import-notifications/receipt-claim-links';
import { buildManualOrderDocumentEmail } from '@/lib/manual-order-document-email';
import { resolveOrderNotificationRecipient } from '@/lib/order-notification-recipient';
import {
  generateReceiptPDF,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { sendEmail } from '@/lib/zeptomail';
import {
  manualDocumentClaimSchema,
  manualDocumentMerchantSchema,
  manualDocumentOrderSchema,
} from '@/schemas/manual-order-document';

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
        'id, merchant_id, customer_id, recorded_by_user_id, import_job_id, external_source, order_number, created_at, transaction_date, invoice_issue_date, currency, total, subtotal, shipping_fee, tax_amount, discount_amount, amount_paid, payment_status, payment_method, shipping_status, customer_name, customer_email, customer_phone, shipping_address, order_items(id, name, quantity, price, variant_name, condition)'
      )
      .eq('id', row.order_id)
      .eq('merchant_id', row.merchant_id)
      .maybeSingle(),
    supabase
      .from('merchants')
      .select(
        'id, slug, custom_domain, business_name, email_sender_name, logo_url, email, phone, support_email, support_phone, business_address, cac_rc_number, tax_identification_number, legal_entity_name, vat_registration_status, vat_rate, bank_code, bank_account_number, bank_name, bank_account_name, brand_colors'
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
    throw new Error('Manual order items unavailable');
  const isPaid = order.payment_status === 'paid';
  const documentKind = isPaid ? 'receipt' : 'invoice';
  if ((row.event_type === 'manual_order_receipt') !== isPaid)
    return { status: 'skipped', reason: 'document_state_changed' };
  if (isPaid && order.amount_paid < order.total)
    throw new Error('Paid manual order has an outstanding balance');
  const receiptOrder: ReceiptOrder = {
    ...order,
    currency: order.currency || 'NGN',
    customer_email: recipient.email,
    amount_paid: order.amount_paid,
    balance: Math.max(0, order.total - order.amount_paid),
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
  };
  const logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
  const pdf = generateReceiptPDF(receiptOrder, receiptMerchant, {
    documentKind,
    documentDate:
      (isPaid ? order.transaction_date : order.invoice_issue_date) ||
      order.created_at,
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
  const content = buildManualOrderDocumentEmail({
    merchantName: merchant.business_name || merchant.slug,
    customerName: order.customer_name,
    customerEmail: recipient.email,
    orderNumber: order.order_number,
    documentKind,
    claimUrl: buildReceiptClaimUrl({ merchant, token: claim.token }),
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
