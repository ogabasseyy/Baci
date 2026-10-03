/**
 * useReceiptPreview — manages the receipt preview state machine
 *
 * State transitions (selectedOrderId is the only state; the rest is derived):
 *   idle → loading (user taps a receipt; orderId selected)
 *   loading → open (detail data arrives, HTML derived during render)
 *   open → idle (user closes the preview)
 *   loading → loading (user taps a different receipt while loading)
 */

import type {
  ReceiptDocumentKind,
  ReceiptMerchant,
  ReceiptOrder,
} from '@baci/shared';
import {
  generateReceiptHtml,
  resolveInvoiceTypeCode,
  showMerchantBankDetails,
} from '@baci/shared';
import { isManualOrderRecord } from '@baci/shared/receipt';
import { useState } from 'react';
import type { ReceiptDetail, ReceiptListItem } from '@/types/receipt';
import { selectReceiptCompletionDate } from './receipt-completion-date';
import { isPromotedManualReceipt } from './receipt-promotion-gates';
import { useMerchantReceiptInfo, useReceiptDetail } from './use-receipts';

export interface ReceiptPreviewOptions {
  /**
   * Explicit document kind for the generated HTML. Order-success passes
   * `proforma` for unpaid invoice orders so the opened artifact matches
   * the "View / Download Proforma Invoice" action that opened it.
   */
  documentKind?: ReceiptDocumentKind;
}

function appendAssuranceLine(
  items: ReceiptDetail['items']
): ReceiptOrder['items'] {
  const total = items.reduce((sum, item) => {
    const fee = Number(item?.assurance_fee ?? 0);
    return sum + (Number.isFinite(fee) && fee > 0 ? fee : 0);
  }, 0);
  if (total <= 0) return items as ReceiptOrder['items'];
  return [
    ...(items as ReceiptOrder['items']),
    {
      product_name: 'Ogabassey Assurance',
      quantity: 1,
      price: total,
    },
  ];
}

export function useReceiptPreview(options: ReceiptPreviewOptions = {}) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { data: merchantInfo } = useMerchantReceiptInfo();

  // null disables the detail query while idle
  const { data: receiptDetail } = useReceiptDetail(selectedOrderId);

  // The preview is open once the detail data for the selected order arrives.
  const isOpen =
    selectedOrderId !== null &&
    !!receiptDetail &&
    !!merchantInfo &&
    receiptDetail.id === selectedOrderId;

  let html = '';
  let isPaid = false;
  // The effective kind behind the generated artifact, mirroring the
  // generator's own resolution (paid always renders the commercial
  // receipt, even with a stale proforma kind). Returned so the modal
  // chrome (title/share labels) reads from the same value the artifact
  // was built with — never a second local derivation that can disagree
  // with it.
  let documentKind: ReceiptDocumentKind = 'invoice';
  if (isOpen) {
    // A fully-covered manual balance is a receipt in substance even under
    // a non-paid label: the generator infers the document from
    // payment_status, so normalize the renderer input like web does —
    // otherwise the app link on an emailed receipt opens the same order
    // as an invoice. Promotion details live in receipt-promotion-gates.
    // Typeof-guarded: a corrupt numeric status must fail closed to '',
    // never throw on .trim() (the detail fetch only warns on schema
    // failure, so numbers can reach here at runtime).
    const normalizeStatus = (value: unknown) =>
      typeof value === 'string'
        ? (value.trim().toLowerCase().replace(/\s+/g, '_') ?? '')
        : '';
    // Promotion comes from the single mobile gate the receipts-list
    // fail-closed fetch consumes too: a row that previews as an invoice
    // can never hard-fail detail load like a paid order, and a promoted
    // row always fails closed on transaction errors instead of misdating.
    const isManualOrder = isManualOrderRecord({
      recordedByUserId: receiptDetail.recorded_by_user_id,
      importJobId: receiptDetail.import_job_id,
      externalSource: receiptDetail.external_source,
    });
    const isManualReceipt = isPromotedManualReceipt({
      recordedByUserId: receiptDetail.recorded_by_user_id,
      importJobId: receiptDetail.import_job_id,
      externalSource: receiptDetail.external_source,
      paymentStatus: receiptDetail.payment_status,
      shippingStatus: receiptDetail.shipping_status,
      total: receiptDetail.total,
      subtotal: receiptDetail.subtotal,
      shippingFee: receiptDetail.shipping_fee,
      taxAmount: receiptDetail.tax_amount,
      discountAmount: receiptDetail.discount_amount,
      amountPaid: receiptDetail.amount_paid,
      currency: receiptDetail.currency,
      items: receiptDetail.items,
    });
    // Legacy spellings ('Paid', ' paid ') count like web's normalized
    // comparison, so the preview agrees with archive/download labels.
    const isPaidReceipt =
      (!isManualOrder &&
        normalizeStatus(receiptDetail.payment_status) === 'paid') ||
      isManualReceipt;
    // Same NGN-only rule as the web document builders: a
    // foreign-currency preview must not print the untyped naira account
    // beside a dollar-denominated balance. The renderer prefers the
    // order-level virtual account, so the guard must cover it — not just
    // the merchant fallback below.
    // Paid receipts are dated by the completing payment like the emailed
    // PDF and account download — never by a stale invoice issue date.
    // Shared with the receipts list so both date from one selector.
    const completionDate = isPaidReceipt
      ? selectReceiptCompletionDate(receiptDetail.transactions)
      : null;
    const showBankDetails = showMerchantBankDetails(receiptDetail.currency);
    const orderData: ReceiptOrder = {
      order_number: receiptDetail.order_number,
      created_at: receiptDetail.created_at,
      transaction_date: completionDate ?? receiptDetail.transaction_date,
      invoice_issue_date: isPaidReceipt
        ? null
        : receiptDetail.invoice_issue_date,
      // Null currency displays as NGN, the generator's own default.
      currency: receiptDetail.currency ?? 'NGN',
      total: receiptDetail.total,
      subtotal: receiptDetail.subtotal,
      shipping_fee: receiptDetail.shipping_fee,
      tax_amount: receiptDetail.tax_amount,
      discount_amount: receiptDetail.discount_amount,
      amount_paid: receiptDetail.amount_paid,
      balance: receiptDetail.balance,
      payment_status: isPaidReceipt ? 'paid' : receiptDetail.payment_status,
      payment_method: receiptDetail.payment_method,
      is_credit_order: receiptDetail.is_credit_order,
      // Null names are sender-permitted (email fallback there): the
      // generator renders the name unconditionally, so fall back here too
      // instead of crashing on the null the warn-only fetch lets through.
      customer_name:
        receiptDetail.customer_name ||
        receiptDetail.customer_email ||
        'Customer',
      customer_email: receiptDetail.customer_email,
      customer_phone: receiptDetail.customer_phone,
      shipping_address: receiptDetail.shipping_address,
      virtual_account: showBankDetails ? receiptDetail.virtual_account : null,
      // Null entries are dropped before generation: the generator
      // dereferences every item, so a corrupt row must degrade to fewer
      // lines, never crash the render. Then itemize the premium like the
      // emailed PDF, web preview, and download so the receipt lines
      // reconcile with the displayed total. ('Ogabassey Assurance' mirrors
      // web ASSURANCE_LINE_NAME; mobile cannot import apps/web.)
      items: appendAssuranceLine(
        (Array.isArray(receiptDetail.items) ? receiptDetail.items : []).filter(
          (item) => item != null && typeof item === 'object'
        )
      ),
      transactions: receiptDetail.transactions,
    };

    const merchant: ReceiptMerchant = {
      business_name: merchantInfo.business_name,
      logo_url: merchantInfo.logo_url,
      email: merchantInfo.email,
      phone: merchantInfo.phone,
      support_email: merchantInfo.support_email,
      support_phone: merchantInfo.support_phone,
      business_address: merchantInfo.business_address,
      cac_rc_number: merchantInfo.cac_rc_number,
      tax_identification_number: merchantInfo.tax_identification_number,
      legal_entity_name: merchantInfo.legal_entity_name,
      brand_colors: merchantInfo.brand_colors ?? undefined,
      vat_registration_status: merchantInfo.vat_registration_status,
      vat_rate: merchantInfo.vat_rate,
      bank_code: showBankDetails ? merchantInfo.bank_code : null,
      bank_account_number: showBankDetails
        ? merchantInfo.bank_account_number
        : null,
      bank_name: showBankDetails ? merchantInfo.bank_name : null,
      bank_account_name: showBankDetails
        ? merchantInfo.bank_account_name
        : null,
      social_media: merchantInfo.social_media,
      pages: merchantInfo.pages,
    };

    // Archive callers open by order id without an explicit kind: derive
    // it from the loaded order through the shared server rule so a
    // never-paid invoice keeps its proforma labeling instead of falling
    // back to the generic commercial "Invoice" — while an explicit
    // stored type code (e.g. 381) survives the derivation untouched.
    // Matches the success-screen classification: only invoices with no
    // prior-payment evidence (never paid, refunded, partially paid, or
    // wallet/savings credited) are proforma.
    const resolvedTypeCode = resolveInvoiceTypeCode({
      paymentMethod: receiptDetail.payment_method,
      isPaid: isPaidReceipt,
      wasPaid: receiptDetail.payment_status === 'refunded',
      paymentStatus: receiptDetail.payment_status,
      amountPaid: receiptDetail.amount_paid,
      storedTypeCode: receiptDetail.invoice_type_code,
    });
    const derivedDocumentKind =
      options.documentKind ??
      (resolvedTypeCode === '325' ? 'proforma' : undefined);
    html = generateReceiptHtml(orderData, merchant, {
      documentKind: derivedDocumentKind,
    });
    isPaid = isPaidReceipt;
    documentKind = isPaid ? 'receipt' : (derivedDocumentKind ?? 'invoice');
  }

  const openPreview = (item: ReceiptListItem) => {
    setSelectedOrderId(item.id);
  };

  const openPreviewByOrderId = (orderId: string) => {
    setSelectedOrderId(orderId);
  };

  const closePreview = () => {
    setSelectedOrderId(null);
  };

  return {
    isLoading: selectedOrderId !== null && !isOpen,
    isOpen,
    html,
    isPaid,
    documentKind,
    openPreview,
    openPreviewByOrderId,
    closePreview,
  };
}
