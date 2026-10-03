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
import { useState } from 'react';
import type { ReceiptListItem } from '@/types/receipt';
import { useMerchantReceiptInfo, useReceiptDetail } from './use-receipts';

export interface ReceiptPreviewOptions {
  /**
   * Explicit document kind for the generated HTML. Order-success passes
   * `proforma` for unpaid invoice orders so the opened artifact matches
   * the "View / Download Proforma Invoice" action that opened it.
   */
  documentKind?: ReceiptDocumentKind;
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
    // a non-paid label (mirrors the manual branch of web isReceiptEligible
    // in storefront-account-document-eligibility.ts): the generator infers
    // the document from payment_status, so normalize the renderer input
    // like web does — otherwise the app link on an emailed receipt opens
    // the same order as an invoice. The balance alone never promotes: a
    // cancelled, unknown-status, or content-invalid manual row fails
    // closed like the sender, archive filter, and download routes. Content
    // validity mirrors web isManualOrderDocumentContentValid: money and
    // items only (a null customer name is sender-permitted), with web
    // coercion — numeric strings count, null/NaN fail. The detail fetch
    // only warns on schema failure, so check here instead of trusting it.
    const normalizeStatus = (value: string | null | undefined) =>
      value?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
    const isValidMoney = (value: unknown) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0;
    const isManualOrder = Boolean(
      receiptDetail.recorded_by_user_id &&
        !receiptDetail.import_job_id &&
        !receiptDetail.external_source?.trim()
    );
    const manualPaymentStatus = normalizeStatus(receiptDetail.payment_status);
    const hasValidContent =
      [
        receiptDetail.total,
        receiptDetail.subtotal,
        receiptDetail.shipping_fee,
        receiptDetail.tax_amount,
        receiptDetail.discount_amount,
        receiptDetail.amount_paid,
      ].every(isValidMoney) &&
      (receiptDetail.currency == null ||
        /^[A-Za-z]{3}$/.test(receiptDetail.currency)) &&
      Array.isArray(receiptDetail.items) &&
      receiptDetail.items.length > 0 &&
      receiptDetail.items.every(
        (item) =>
          typeof item.product_name === 'string' &&
          isValidMoney(item.price) &&
          item.quantity !== null &&
          item.quantity !== undefined &&
          Number.isFinite(Number(item.quantity)) &&
          Number(item.quantity) > 0
      );
    const isManualReceipt =
      isManualOrder &&
      !['cancelled', 'canceled', 'returned', 'failed'].includes(
        normalizeStatus(receiptDetail.shipping_status)
      ) &&
      ['paid', 'unpaid', 'pending', 'partially_paid'].includes(
        manualPaymentStatus
      ) &&
      Number(receiptDetail.amount_paid) >= Number(receiptDetail.total) &&
      hasValidContent;
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
    // PDF and account download — never by a stale invoice issue date,
    // which the generator would otherwise prefer. Settled statuses match
    // web resolveManualDocumentReceiptDate exactly.
    const completionDate = isPaidReceipt
      ? ((receiptDetail.transactions ?? [])
          .filter(
            (txn) =>
              txn.transaction_type === 'payment' &&
              (txn.status === 'completed' || txn.status === 'success') &&
              txn.created_at != null
          )
          .map((txn) => txn.created_at as string)
          .sort((left, right) => Date.parse(left) - Date.parse(right))
          .pop() ?? null)
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
      items: receiptDetail.items,
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
