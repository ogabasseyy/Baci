/**
 * useReceiptPreview — manages the receipt preview state machine
 *
 * State transitions (selectedOrderId is the only state; the rest is derived):
 *   idle → loading (user taps a receipt; orderId selected)
 *   loading → open (detail data arrives, HTML derived during render)
 *   open → idle (user closes the preview)
 *   loading → loading (user taps a different receipt while loading)
 */

import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { generateReceiptHtml } from '@baci/shared';
import { useState } from 'react';
import type { ReceiptListItem } from '@/types/receipt';
import { useMerchantReceiptInfo, useReceiptDetail } from './use-receipts';

export function useReceiptPreview() {
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
  if (isOpen) {
    const orderData: ReceiptOrder = {
      order_number: receiptDetail.order_number,
      created_at: receiptDetail.created_at,
      transaction_date: receiptDetail.transaction_date,
      invoice_issue_date: receiptDetail.invoice_issue_date,
      currency: receiptDetail.currency,
      total: receiptDetail.total,
      subtotal: receiptDetail.subtotal,
      shipping_fee: receiptDetail.shipping_fee,
      tax_amount: receiptDetail.tax_amount,
      discount_amount: receiptDetail.discount_amount,
      amount_paid: receiptDetail.amount_paid,
      balance: receiptDetail.balance,
      payment_status: receiptDetail.payment_status,
      payment_method: receiptDetail.payment_method,
      is_credit_order: receiptDetail.is_credit_order,
      customer_name: receiptDetail.customer_name,
      customer_email: receiptDetail.customer_email,
      customer_phone: receiptDetail.customer_phone,
      shipping_address: receiptDetail.shipping_address,
      virtual_account: receiptDetail.virtual_account,
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
      bank_code: merchantInfo.bank_code,
      bank_account_number: merchantInfo.bank_account_number,
      bank_name: merchantInfo.bank_name,
      bank_account_name: merchantInfo.bank_account_name,
      social_media: merchantInfo.social_media,
      pages: merchantInfo.pages,
    };

    html = generateReceiptHtml(orderData, merchant);
    isPaid = receiptDetail.payment_status === 'paid';
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
    openPreview,
    openPreviewByOrderId,
    closePreview,
  };
}
