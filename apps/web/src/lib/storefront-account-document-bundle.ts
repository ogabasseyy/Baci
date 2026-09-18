import {
  appendReceiptFulfillmentDescription,
  formatOrderItemDisplayName,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  type ReceiptMerchant,
  type ReceiptOrder,
  resolveReceiptItemFulfillmentAttachment,
} from '@baci/shared';
import {
  buildAssuranceInvoiceLineItem,
  buildAssuranceReceiptItem,
  nextInvoiceLineId,
  reconcileAssuranceTaxSubtotal,
  sumAssuranceFees,
} from '@/lib/insurance-assurance-line';
import type {
  InvoiceData,
  InvoiceLineItem,
  TaxSubtotal,
} from '@/lib/invoice-generator';
import { deriveTaxSubtotalsFromInvoiceItems } from '@/lib/invoice-tax-subtotals';
import type {
  StorefrontAccountDocumentCustomerRow,
  StorefrontAccountDocumentItemRow,
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentPaymentAccountRow,
  StorefrontAccountDocumentTaxSubtotalRow,
  StorefrontAccountDocumentTransactionRow,
} from '@/lib/storefront-account-document-bundle.types';
import {
  buildReceiptMerchant,
  buildReceiptOrder,
} from '@/lib/storefront-account-document-receipt';
import {
  asNumber,
  asRecord,
  asString,
  buildCustomerAddress,
  buildOrderItems,
  normalizeShippingAddress,
} from '@/lib/storefront-account-document-values';
import type { StorefrontOrder } from '@/types/storefront-order';

interface BuildStorefrontAccountDocumentBundleInput {
  merchant: StorefrontAccountDocumentMerchantRow;
  customer: StorefrontAccountDocumentCustomerRow;
  order: StorefrontAccountDocumentOrderRow;
  itemRows: StorefrontAccountDocumentItemRow[];
  transactions: StorefrontAccountDocumentTransactionRow[];
  paymentAccount: StorefrontAccountDocumentPaymentAccountRow | null;
  taxRows: StorefrontAccountDocumentTaxSubtotalRow[];
  paymentStatus: string;
  shippingStatus: string;
  currentDocumentKind: 'invoice' | 'receipt';
  canCancel?: boolean;
}

function resolveMoneyValue(
  value: number | string | null | undefined,
  fallback: number
) {
  return value == null ? fallback : asNumber(value);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

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

export function buildStorefrontAccountDocumentBundle({
  merchant,
  customer,
  order,
  itemRows,
  transactions,
  paymentAccount,
  taxRows,
  paymentStatus,
  shippingStatus,
  currentDocumentKind,
  canCancel = false,
}: BuildStorefrontAccountDocumentBundleInput) {
  const currency = asString(order.currency) || 'NGN';
  const total = asNumber(order.total);
  const subtotal = asNumber(order.subtotal);
  const shippingFee = asNumber(order.shipping_fee);
  const taxAmount = asNumber(order.tax_amount);
  const discountAmount = asNumber(order.discount_amount);
  const amountPaid = asNumber(order.amount_paid);
  const balance = Math.max(0, total - amountPaid);
  const taxInclusiveAmount = resolveMoneyValue(
    order.tax_inclusive_amount,
    total
  );
  const preTaxTotal = Math.max(0, taxInclusiveAmount - taxAmount);
  const shippingAddress = normalizeShippingAddress(order.shipping_address);
  const orderItems = buildOrderItems(itemRows);
  const fallbackName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const customerName =
    asString(order.customer_name) || fallbackName || 'Customer';
  const customerEmail = asString(order.customer_email) || customer.email || '';
  const customerPhone =
    asString(order.customer_phone) || customer.phone || null;
  const receiptEligible = currentDocumentKind === 'receipt';
  const registeredAddress = asRecord(merchant.registered_address);
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

  const receiptMerchant: ReceiptMerchant = buildReceiptMerchant(merchant);
  const receiptOrder: ReceiptOrder = buildReceiptOrder({
    order,
    orderItems,
    transactions,
    paymentAccount,
    paymentStatus,
    shippingAddress,
    currency,
    total,
    subtotal,
    shippingFee,
    taxAmount,
    discountAmount,
    amountPaid,
    balance,
    customerName,
    customerEmail,
    customerPhone,
  });

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
    receiptOrder.items.push(buildAssuranceReceiptItem(assuranceTotal));
    // VAT orders: add only the premium to an O subtotal (shipping/discount stay
    // in their taxable category). Non-VAT orders: reconcile the O bucket up to
    // BT-109 so Σ TaxableAmount === BT-109 (Peppol BR-CO-13).
    reconcileAssuranceTaxSubtotal(
      taxSubtotals,
      documentTaxExclusive,
      assuranceTotal
    );
  }

  const orderDetail: StorefrontOrder = {
    id: order.id,
    order_number: order.order_number,
    created_at: order.created_at,
    updated_at: order.updated_at || undefined,
    shipping_status: shippingStatus,
    payment_status: paymentStatus,
    tracking_number: order.tracking_number || undefined,
    subtotal,
    total,
    shipping_fee: shippingFee,
    shipping_cost: shippingFee,
    shipping_provider: order.shipping_provider || undefined,
    shipping_rate_id: order.shipping_rate_id || undefined,
    shipping_rate_name: order.shipping_rate_name || undefined,
    shipping_pickup_details: order.shipping_pickup_details ?? null,
    shipping_address: shippingAddress,
    payment_method: order.payment_method || undefined,
    payment_provider: order.payment_method || undefined,
    paymentMethod: order.payment_method || undefined,
    items: orderItems,
    currency,
    amount_paid: amountPaid,
    tax_amount: taxAmount,
    discount_amount: discountAmount,
    balance,
    current_document_kind: currentDocumentKind,
    receipt_eligible: receiptEligible,
    can_cancel: canCancel,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    merchant_support_email: merchant.support_email || null,
    merchant_support_phone: merchant.support_phone || null,
    rider_phone_number: merchant.rider_phone_number || null,
    notes: order.notes || null,
    transactions: transactions.map((transaction) => ({
      id: transaction.id || undefined,
      amount: asNumber(transaction.amount),
      created_at: transaction.created_at,
      description: transaction.description,
      metadata: transaction.metadata,
    })),
    virtual_account: receiptOrder.virtual_account || null,
  };

  const invoiceData: InvoiceData = {
    invoice_number: order.order_number,
    invoice_type_code: order.invoice_type_code || '380',
    issue_date: order.invoice_issue_date
      ? new Date(order.invoice_issue_date)
      : order.transaction_date
        ? new Date(order.transaction_date)
        : new Date(order.created_at),
    tax_point_date: order.tax_point_date
      ? new Date(order.tax_point_date)
      : undefined,
    due_date: order.payment_due_date
      ? new Date(order.payment_due_date)
      : undefined,
    currency,
    buyer_reference: order.buyer_reference || undefined,
    purchase_order_reference: order.purchase_order_reference || undefined,
    merchant: {
      business_name: merchant.business_name,
      legal_entity_name: merchant.legal_entity_name || undefined,
      tax_identification_number:
        merchant.tax_identification_number || undefined,
      cac_rc_number: merchant.cac_rc_number || undefined,
      vat_registration_status:
        merchant.vat_registration_status || 'unregistered',
      vat_rate: merchant.vat_rate ?? 0,
      registered_address: registeredAddress
        ? {
            street: asString(registeredAddress.street),
            city: asString(registeredAddress.city),
            state: asString(registeredAddress.state),
            postal_code: asString(registeredAddress.postal_code),
            country: asString(registeredAddress.country),
          }
        : undefined,
      support_email: merchant.support_email || undefined,
      support_phone: merchant.support_phone || undefined,
      logo_url: merchant.logo_url || undefined,
    },
    customer: {
      name: customerName,
      email: customerEmail || undefined,
      phone: customerPhone || undefined,
      address: buildCustomerAddress(shippingAddress),
    },
    items: invoiceItems,
    tax_subtotals: taxSubtotals,
    subtotal,
    tax_exclusive_amount: documentTaxExclusive,
    tax_amount: taxAmount,
    tax_inclusive_amount: documentTaxInclusive,
    shipping_fee: shippingFee,
    discount_amount: discountAmount,
    total,
    amount_paid: amountPaid,
    notes: order.invoice_note || order.notes || undefined,
    payment_terms: order.payment_terms || undefined,
    payment_account: paymentAccount
      ? {
          account_number: paymentAccount.account_number,
          account_name: paymentAccount.account_name || undefined,
          bank_name: paymentAccount.bank_name || undefined,
        }
      : merchant.bank_account_number
        ? {
            account_number: merchant.bank_account_number,
            account_name:
              merchant.bank_account_name ||
              merchant.legal_entity_name ||
              merchant.business_name ||
              undefined,
            bank_name: merchant.bank_name || undefined,
          }
        : undefined,
    firs_irn: order.firs_irn || undefined,
    firs_csid: order.firs_csid || undefined,
    firs_qr_code: order.firs_qr_code || undefined,
  };

  return {
    order: orderDetail,
    invoiceData,
    receiptOrder,
    receiptMerchant,
  };
}
