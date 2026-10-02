import {
  appendReceiptFulfillmentDescription,
  formatOrderItemDisplayName,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  resolveReceiptItemFulfillmentAttachment,
} from '@baci/shared';
import {
  buildAssuranceInvoiceLineItem,
  nextInvoiceLineId,
  reconcileAssuranceTaxSubtotal,
  sumAssuranceFees,
} from '@/lib/insurance-assurance-line';
import type { InvoiceLineItem, TaxSubtotal } from '@/lib/invoice-generator';
import { deriveTaxSubtotalsFromInvoiceItems } from '@/lib/invoice-tax-subtotals';
import type {
  StorefrontAccountDocumentItemRow,
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentTaxSubtotalRow,
} from '@/lib/storefront-account-document-bundle.types';
import {
  asNumber,
  resolveMoneyValue,
  roundCurrency,
} from '@/lib/storefront-account-document-values';
import type { StorefrontOrderItem } from '@/types/storefront-order';

function alignSingleZeroTaxSubtotalWithDocumentTotal(
  subtotals: TaxSubtotal[],
  taxExclusiveAmount: number
) {
  const subtotal = subtotals.length === 1 ? subtotals[0] : null;

  if (subtotal?.tax_amount !== 0) {
    return;
  }

  subtotal.taxable_amount = taxExclusiveAmount;
}

export interface BuildInvoiceContentInput {
  order: Pick<
    StorefrontAccountDocumentOrderRow,
    'tax_exclusive_amount' | 'fulfillment_details'
  >;
  merchant: Pick<
    StorefrontAccountDocumentMerchantRow,
    'vat_registration_status' | 'vat_rate'
  >;
  orderItems: StorefrontOrderItem[];
  itemRows: StorefrontAccountDocumentItemRow[];
  taxRows: StorefrontAccountDocumentTaxSubtotalRow[];
  taxAmount: number;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  preTaxTotal: number;
  taxInclusiveAmount: number;
}

export interface BuildInvoiceContentResult {
  invoiceItems: InvoiceLineItem[];
  taxSubtotals: TaxSubtotal[];
  documentTaxExclusive: number;
  documentTaxInclusive: number;
  assuranceTotal: number;
}

export function buildInvoiceContent({
  order,
  merchant,
  orderItems,
  itemRows,
  taxRows,
  taxAmount,
  subtotal,
  shippingFee,
  discountAmount,
  preTaxTotal,
  taxInclusiveAmount,
}: BuildInvoiceContentInput): BuildInvoiceContentResult {
  const sellerIsVatRegistered =
    merchant.vat_registration_status === 'registered';
  const invoiceVatRate = merchant.vat_rate ?? 7.5;
  const lineExtensionTotal = orderItems.reduce(
    (totalAmount, item) =>
      totalAmount +
      (typeof item.line_extension_amount === 'number' &&
      Number.isFinite(item.line_extension_amount)
        ? item.line_extension_amount
        : item.quantity * item.price),
    0
  );
  const singleTaxSubtotal = taxRows.length === 1 ? taxRows[0] : null;
  const fallbackLineVatCategoryCode =
    singleTaxSubtotal?.vat_category_code ||
    (taxRows.length === 0 && taxAmount > 0 && sellerIsVatRegistered
      ? 'S'
      : taxRows.length === 0 && !sellerIsVatRegistered
        ? 'O'
        : null);
  const fallbackLineVatRate =
    singleTaxSubtotal != null
      ? asNumber(singleTaxSubtotal.vat_rate)
      : taxRows.length === 0 && taxAmount > 0 && sellerIsVatRegistered
        ? invoiceVatRate
        : taxRows.length === 0 && !sellerIsVatRegistered
          ? 0
          : null;
  const shouldAllocateFallbackVat =
    fallbackLineVatCategoryCode != null &&
    fallbackLineVatRate != null &&
    taxAmount > 0 &&
    lineExtensionTotal > 0;
  let allocatedVatAmount = 0;

  const hasDeviceItem = orderItems.some((item) =>
    isDeviceReceiptItemName(item.product_name || item.name || '')
  );
  const orderFulfillment = normalizeReceiptFulfillmentDetails(
    order.fulfillment_details
  );
  const invoiceItems: InvoiceLineItem[] = orderItems.map((item, index) => {
    const lineExtensionAmount =
      typeof item.line_extension_amount === 'number' &&
      Number.isFinite(item.line_extension_amount)
        ? item.line_extension_amount
        : item.quantity * item.price;
    const explicitVatCategoryCode = item.vat_category_code?.trim();
    const explicitVatRate =
      typeof item.vat_rate === 'number' && Number.isFinite(item.vat_rate)
        ? item.vat_rate
        : null;
    const explicitVatAmount =
      typeof item.vat_amount === 'number' && Number.isFinite(item.vat_amount)
        ? item.vat_amount
        : null;
    const shouldUseExplicitVatAmount =
      explicitVatAmount != null &&
      !(explicitVatAmount === 0 && shouldAllocateFallbackVat);
    const lineVatCategoryCode =
      explicitVatCategoryCode || fallbackLineVatCategoryCode;
    const lineVatRate = explicitVatRate ?? fallbackLineVatRate;
    const vatAmount = shouldUseExplicitVatAmount
      ? explicitVatAmount
      : shouldAllocateFallbackVat
        ? index === orderItems.length - 1
          ? roundCurrency(taxAmount - allocatedVatAmount)
          : roundCurrency(
              (lineExtensionAmount / lineExtensionTotal) * taxAmount
            )
        : lineVatCategoryCode && lineVatRate != null
          ? 0
          : null;

    if (
      !shouldUseExplicitVatAmount &&
      shouldAllocateFallbackVat &&
      vatAmount != null
    ) {
      allocatedVatAmount += vatAmount;
    }
    if (shouldUseExplicitVatAmount) {
      allocatedVatAmount += explicitVatAmount;
    }

    const itemName = formatOrderItemDisplayName({
      baseName: item.product_name || item.name || 'Item',
      condition: item.condition,
      variantName: item.variant_name,
    });
    const itemFulfillment = normalizeReceiptFulfillmentDetails(
      item.fulfillment_details
    );
    const fulfillmentAttachment = resolveReceiptItemFulfillmentAttachment({
      hasDeviceItem,
      index,
      item,
      itemFulfillment,
      orderFulfillment,
    });

    return {
      line_id: index + 1,
      product_id: item.product_id || undefined,
      name: itemName,
      description: appendReceiptFulfillmentDescription({
        description: undefined,
        fulfillment: fulfillmentAttachment.fulfillment,
        hasDeviceItem: fulfillmentAttachment.hasDeviceItem,
        index: fulfillmentAttachment.index,
        itemName,
      }),
      quantity: item.quantity,
      unit_code: item.unit_code || 'EA',
      price: item.price,
      line_extension_amount: lineExtensionAmount,
      sellers_item_id: item.sellers_item_id || undefined,
      ...(lineVatCategoryCode && lineVatRate != null
        ? {
            vat_category_code: lineVatCategoryCode,
            vat_rate: lineVatRate,
            vat_amount: vatAmount ?? 0,
          }
        : {}),
    };
  });

  const taxSubtotals: TaxSubtotal[] = taxRows.map((subtotalRow) => ({
    vat_category_code: subtotalRow.vat_category_code,
    vat_rate: asNumber(subtotalRow.vat_rate),
    taxable_amount: asNumber(subtotalRow.taxable_amount),
    tax_amount: asNumber(subtotalRow.tax_amount),
    exemption_reason: subtotalRow.exemption_reason || undefined,
  }));

  const derivedLineTaxSubtotals =
    deriveTaxSubtotalsFromInvoiceItems(invoiceItems);
  if (
    taxSubtotals.length === 0 &&
    derivedLineTaxSubtotals.length > 0 &&
    (taxAmount === 0 ||
      derivedLineTaxSubtotals.some((subtotal) => subtotal.tax_amount > 0))
  ) {
    taxSubtotals.push(...derivedLineTaxSubtotals);
  }
  if (taxSubtotals.length === 0 && taxAmount > 0 && sellerIsVatRegistered) {
    taxSubtotals.push({
      vat_category_code: 'S',
      vat_rate: invoiceVatRate,
      taxable_amount: subtotal,
      tax_amount: taxAmount,
    });
  }
  if (taxSubtotals.length === 0 && !sellerIsVatRegistered) {
    taxSubtotals.push({
      vat_category_code: 'O',
      vat_rate: 0,
      taxable_amount: subtotal,
      tax_amount: 0,
      exemption_reason: 'Seller is not VAT registered',
    });
  }
  if (taxRows.length === 0) {
    alignSingleZeroTaxSubtotalWithDocumentTotal(taxSubtotals, preTaxTotal);
  }

  // Ogabassey Assurance is rolled into order.subtotal but VAT-free and was never
  // itemized — surface it as a single zero-rated line so the document reconciles.
  const assuranceTotal = sumAssuranceFees(itemRows);

  // Document tax-exclusive (BT-109) / tax-inclusive (BT-112) totals. For
  // assurance orders, derive BT-109 from `subtotal` (which includes the VAT-free
  // premium on BOTH order-creation paths) + shipping - discount, rather than the
  // stored tax totals: storefront RPC orders persist tax_exclusive_amount as a
  // product-only line sum that excludes the premium, so reusing it would leave
  // the itemized assurance line + tax subtotal exceeding BT-109 by the premium.
  const documentTaxExclusive =
    assuranceTotal > 0
      ? Number((subtotal + shippingFee - discountAmount).toFixed(2))
      : resolveMoneyValue(order.tax_exclusive_amount, preTaxTotal);
  const documentTaxInclusive =
    assuranceTotal > 0
      ? Number((documentTaxExclusive + taxAmount).toFixed(2))
      : taxInclusiveAmount;

  if (assuranceTotal > 0) {
    invoiceItems.push(
      buildAssuranceInvoiceLineItem(
        nextInvoiceLineId(invoiceItems),
        assuranceTotal
      )
    );
    // VAT orders: add only the premium to an O subtotal (shipping/discount stay
    // in their taxable category). Non-VAT orders: reconcile the O bucket up to
    // BT-109 so Σ TaxableAmount === BT-109 (Peppol BR-CO-13).
    reconcileAssuranceTaxSubtotal(
      taxSubtotals,
      documentTaxExclusive,
      assuranceTotal
    );
  }

  return {
    invoiceItems,
    taxSubtotals,
    documentTaxExclusive,
    documentTaxInclusive,
    assuranceTotal,
  };
}
