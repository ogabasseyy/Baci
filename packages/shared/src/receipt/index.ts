export { getBankNameFromCode, resolveMerchantBankName } from './bank-codes';
export { escapeHtml, escapeJsString } from './escape-html';
export { generateReceiptHtml } from './generate-receipt-html';
export {
  canonicalizeTransactionPaymentMethod,
  isDecimalMoney,
  isManualOrderRecord,
  isNonNegativeMoney,
  isSettledManualBalance,
  MANUAL_ORDER_CURRENCY_CODE_PATTERN,
  MANUAL_ORDER_INVOICE_ONLY_ITEM_FINANCIAL_FIELDS,
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
  MANUAL_ORDER_RECEIPT_ITEM_FINANCIAL_FIELDS,
  type ManualOrderInvoiceOnlyItemFinancialField,
  type ManualOrderItemFinancialField,
  type ManualOrderReceiptItemFinancialField,
} from './manual-order-document-gates';
export {
  appendReceiptFulfillmentDescription,
  getReceiptFulfillmentRows,
  getReceiptFulfillmentRowsFromDetails,
  getReceiptFulfillmentSummary,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  resolveReceiptItemFulfillmentAttachment,
  resolveReceiptItemFulfillmentDetails,
  shouldAttachFulfillmentToItem,
} from './receipt-fulfillment';
export {
  getReceiptDisplaySubtotal,
  getReceiptItemDetailLines,
  getReceiptItemLineTotal,
  getReceiptItemVatLines,
  getReceiptVatRate,
  type ReceiptLineItemLike,
  shouldShowVatLine,
  type VatBreakdownMerchant,
  type VatBreakdownOrder,
} from './receipt-money';
export {
  compareReceiptListDesc,
  type ReceiptSortable,
  selectReceiptDisplayDate,
} from './receipt-sort';
export { resolveInvoiceTypeCode } from './resolve-invoice-type-code';
export { sanitizeSvg } from './sanitize-svg';
export { showMerchantBankDetails } from './show-merchant-bank-details';
export type {
  ReceiptDocumentKind,
  ReceiptFulfillmentDetails,
  ReceiptMerchant,
  ReceiptOptions,
  ReceiptOrder,
} from './types';
