import { isDeviceReceiptItemName, type ReceiptOrder } from '@baci/shared';
import { buildImmediateInvoiceMerchant } from '@/lib/build-immediate-invoice-merchant';
import { mergeReceiptItemsWithInvoiceMetadata } from '@/lib/invoice-receipt-item-metadata';
import { logger } from '@/lib/logger';
import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import {
  generatePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
} from '@/lib/peppol-ubl-invoice';
import { provisionInvoiceMethodDva } from '@/lib/provision-invoice-method-dva';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { redactOrderTrackingLinkForLog } from '@/lib/redact-order-tracking-link-for-log';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './invoice-credit';
import { buildImmediatePeppolInvoiceData } from './invoice-data';
import type {
  ImmediateInvoiceArtifacts,
  ImmediateOrderNotificationContext,
} from './notification-context';
import {
  getImmediateInvoiceDueDate,
  getOrderFulfillmentDetails,
  getOrderItemBaseName,
} from './order-item-primitives';
import { loadPersistedInvoiceOrderItems } from './persisted-invoice-items';
import { buildInvoiceReceiptOrder } from './receipt-order';

export async function buildImmediateInvoiceArtifacts(
  ctx: ImmediateOrderNotificationContext
): Promise<ImmediateInvoiceArtifacts> {
  const { order, orderNum, merchant } = ctx;
  // No admin client (AGENTS.md): reads go through the proof-bound
  // get_invoice_artifact_order_items RPC, DVA persistence through the
  // proof-bound reserve RPC, and the reminder through the proof-bound
  // insert_invoice_reminder RPC — all on the request-scoped client.
  const requestSupabase = ctx.supabase;
  let attachments:
    | Array<{ name: string; content: string; mime_type: string }>
    | undefined;
  let emailedInvoiceTypeCode: string | undefined;
  let invoiceVirtualAccount: ReceiptOrder['virtual_account'] = null;
  // Amount already covered, derived BEFORE the fallible invoice work:
  // if persisted-item loading or DVA provisioning throws, the catch
  // still renders the email, and a zero here would instruct the full
  // price despite credit already applied (P1 overpayment guard — same
  // rule as the attached PDF).
  const invoiceAmountPaid = getCreditedAmountPaid(
    order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  // Outstanding balance for the transfer instructions (same rule as the
  // attached PDF). Computed before provisioning so fully discounted
  // orders skip DVA creation entirely.
  const emailAmountDue = getImmediateEmailAmountDue(
    ctx.orderTotal,
    invoiceAmountPaid
  );
  try {
    const invoiceTimingOrder = {
      ...(order as Record<string, unknown>),
      created_at:
        typeof order.created_at === 'string'
          ? order.created_at
          : new Date().toISOString(),
    };
    // The customer can send display-only item names/prices, while the
    // storefront order RPC persists canonical product/variant snapshots.
    // Render invoice artifacts from those persisted rows after the
    // validated order exists.
    const persistedInvoiceItems = await loadPersistedInvoiceOrderItems({
      orderId: order.id,
      trackingToken: ctx.trackingToken,
      supabase: requestSupabase,
    });
    if (!persistedInvoiceItems) {
      logger.error({
        message:
          'Persisted order items unavailable for invoice email; skipping non-canonical invoice artifacts',
        orderId: order.id,
      });
      throw new Error('PERSISTED_INVOICE_ITEMS_UNAVAILABLE');
    }
    const invoiceItems = persistedInvoiceItems;

    // System-owned DVA/reminder records are written after the validated
    // order exists; customers do not own these tables through RLS, so
    // the server-only admin client is scoped to this post-response side
    // effect and order.id.
    // A zero-due order has nothing to transfer: skip provisioning so
    // the PDF and later receipt lookups carry no virtual account for an
    // impossible payment.
    if (emailAmountDue > 0) {
      const invoiceOutcome = await provisionInvoiceMethodDva({
        persistAssignment: (assignment) =>
          persistPaystackDvaAssignment(requestSupabase, assignment),
        customerEmail: ctx.customerEmail,
        customerName: ctx.customerName,
        customerPhone: ctx.customerPhone ?? null,
        merchantPhone: merchant.phone ?? null,
        orderId: order.id,
        // Shared invoice timing: the DVA expiry and the PDF due date
        // derive from the identical instant.
        expiresAt: getImmediateInvoiceDueDate(invoiceTimingOrder).toISOString(),
        orderCurrency: ctx.orderCurrency,
        orderLabel: 'invoice',
      });
      invoiceVirtualAccount =
        invoiceOutcome.outcome === 'provisioned'
          ? invoiceOutcome.virtualAccount
          : null;
    }

    const fulfillment = getOrderFulfillmentDetails(
      order as Record<string, unknown>
    );
    const hasDeviceItem = invoiceItems.some((item) =>
      isDeviceReceiptItemName(getOrderItemBaseName(item))
    );
    const amountPaid = invoiceAmountPaid;
    const invoiceOrder = {
      ...invoiceTimingOrder,
      amount_paid: amountPaid,
      // The RPC return row carries no currency; without this the Peppol
      // XML falls back to NGN while the PDF/email use the stamped order
      // currency.
      currency: ctx.orderCurrency,
    };
    const receiptOrder = buildInvoiceReceiptOrder({
      ctx,
      invoiceItems,
      fulfillment,
      hasDeviceItem,
      amountPaid,
      invoiceVirtualAccount,
    });
    const receiptMerchant = buildImmediateInvoiceMerchant(
      merchant,
      ctx.orderCurrency
    );
    const peppolInvoiceData = buildImmediatePeppolInvoiceData({
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      customerPhone: ctx.customerPhone ?? undefined,
      fulfillment,
      items: invoiceItems,
      merchant,
      notes: ctx.notes,
      order: invoiceOrder,
      orderNumber: orderNum,
      orderShippingFee: ctx.orderShippingFee,
      orderSubtotal: ctx.orderSubtotal,
      orderTotal: ctx.orderTotal,
      paymentAccount: invoiceVirtualAccount,
      paymentMethod: ctx.effectivePaymentMethod,
      isPaid: ctx.immediateEmail.isPaidForEmail,
      paymentStatus: receiptOrder.payment_status,
      amountPaid,
      shippingAddress: ctx.shippingAddress,
    });
    let peppolInvoiceXml: string | null = null;

    // Peppol UBL is a commercial-invoice artifact: proforma (325)
    // documents carry no Peppol XML or compliance note.
    if (peppolInvoiceData.invoice_type_code !== '325') {
      try {
        peppolInvoiceXml = generatePeppolInvoiceXml(peppolInvoiceData);
      } catch (peppolError) {
        logger.error({
          message: 'Failed to generate Peppol UBL invoice XML',
          orderId: order.id,
          orderNumber: orderNum,
          error: peppolError,
        });
      }
    }

    let logoDataUri: string | null = null;
    try {
      logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
    } catch (logoError) {
      logger.warn({
        message: 'Failed to resolve invoice logo; using fallback PDF branding',
        orderId: order.id,
        orderNumber: orderNum,
        error: logoError,
      });
    }

    const invoiceReceiptOrder: ReceiptOrder = {
      ...receiptOrder,
      items: mergeReceiptItemsWithInvoiceMetadata(
        receiptOrder.items,
        peppolInvoiceData.items
      ),
    };
    const pdfBlob = generateReceiptBlob(invoiceReceiptOrder, receiptMerchant, {
      buyerReference: peppolInvoiceData.buyer_reference,
      complianceNote: peppolInvoiceXml
        ? PEPPOL_BIS_BILLING_COMPLIANCE_NOTE
        : undefined,
      documentDate: peppolInvoiceData.issue_date,
      documentKind:
        peppolInvoiceData.invoice_type_code === '325'
          ? 'proforma_invoice'
          : 'invoice',
      dueDate: peppolInvoiceData.due_date,
      firsCsid: peppolInvoiceData.firs_csid,
      firsIrn: peppolInvoiceData.firs_irn,
      invoiceTypeCode: peppolInvoiceData.invoice_type_code,
      invoiceNotes: peppolInvoiceData.notes,
      logoDataUri,
      paymentTerms: peppolInvoiceData.payment_terms,
      taxSubtotals: peppolInvoiceData.tax_subtotals,
    });
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64Content = Buffer.from(arrayBuffer).toString('base64');
    emailedInvoiceTypeCode = peppolInvoiceData.invoice_type_code;
    const documentFilePrefix =
      emailedInvoiceTypeCode === '325' ? 'proforma' : 'invoice';

    attachments = [
      {
        name: `${documentFilePrefix}-${orderNum}.pdf`,
        content: base64Content,
        mime_type: 'application/pdf',
      },
    ];

    if (peppolInvoiceXml) {
      attachments.push({
        name: `invoice-${orderNum}.xml`,
        content: Buffer.from(peppolInvoiceXml, 'utf8').toString('base64'),
        mime_type: 'application/xml',
      });
    }

    // Log standard initial reminder row in order_reminders through
    // the proof-bound insert (request client, no admin).
    let reminderInsertError: unknown = null;
    if (ctx.trackingToken) {
      const { error } = await requestSupabase.rpc('insert_invoice_reminder', {
        p_channel: 'email',
        p_order_id: order.id,
        p_payment_link: ctx.paymentLink,
        p_tracking_token: ctx.trackingToken,
      });
      reminderInsertError = error;
    } else {
      reminderInsertError = new Error('missing tracking proof');
    }

    if (reminderInsertError) {
      logger.error({
        message: 'Failed to store initial invoice reminder',
        orderId: order.id,
        // Never log the full URL: its query string carries the tracking
        // token and possibly the customer email.
        paymentLink: redactOrderTrackingLinkForLog(ctx.paymentLink),
        error: reminderInsertError,
      });
    } else {
      logger.info({
        message: 'Stored initial invoice reminder successfully',
        orderId: order.id,
        paymentLink: redactOrderTrackingLinkForLog(ctx.paymentLink),
      });
    }

    logger.info({
      message: 'Generated branded invoice PDF and logged initial reminder',
      orderId: order.id,
      orderNumber: orderNum,
    });
  } catch (err) {
    logger.error({
      message: 'Failed to generate invoice PDF or log initial reminder',
      orderId: order.id,
      error: err,
    });
  }

  return { attachments, emailedInvoiceTypeCode, invoiceVirtualAccount };
}
