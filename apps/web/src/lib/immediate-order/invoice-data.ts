import {
  appendReceiptFulfillmentDescription,
  isDeviceReceiptItemName,
  type ReceiptFulfillmentDetails,
  type ReceiptOrder,
} from '@baci/shared';
import type {
  InvoiceData,
  InvoiceLineItem,
  TaxSubtotal,
} from '@/lib/invoice-generator';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import type { OrderCreateInput } from '@/schemas/orders';
import {
  getImmediateInvoiceDueDate,
  getImmediateInvoiceIssueDate,
  getOrderItemBaseName,
  getOrderItemDisplayName,
  getOrderItemProductId,
  getOrderItemUnitPrice,
  getOrderItemVariantLabel,
  roundCurrency,
  SERVER_ASSURANCE_RATE,
  toFiniteNumber,
} from './order-item-primitives';
import type { ImmediateInvoiceOrderItem } from './persisted-invoice-items';

function getOrderItemAssuranceFee(item: ImmediateInvoiceOrderItem) {
  const persistedAssuranceFee = toFiniteNumber(item.assurance_fee);
  if (persistedAssuranceFee !== null) {
    return roundCurrency(persistedAssuranceFee);
  }

  const itemBaseTotal = item.quantity * getOrderItemUnitPrice(item);

  return item.has_assurance
    ? roundCurrency(itemBaseTotal * SERVER_ASSURANCE_RATE)
    : 0;
}

function getOrderItemLineExtensionAmount(item: ImmediateInvoiceOrderItem) {
  const persistedLineExtensionAmount = toFiniteNumber(
    item.line_extension_amount
  );

  if (persistedLineExtensionAmount !== null) {
    return roundCurrency(persistedLineExtensionAmount);
  }

  return roundCurrency(
    item.quantity * getOrderItemUnitPrice(item) + getOrderItemAssuranceFee(item)
  );
}

function allocateLineTax(input: {
  index: number;
  itemCount: number;
  lineExtensionAmount: number;
  lineExtensionTotal: number;
  taxAmount: number;
  allocatedTaxAmount: number;
}) {
  if (input.taxAmount <= 0 || input.lineExtensionTotal <= 0) {
    return 0;
  }

  if (input.index === input.itemCount - 1) {
    return roundCurrency(input.taxAmount - input.allocatedTaxAmount);
  }

  return roundCurrency(
    (input.lineExtensionAmount / input.lineExtensionTotal) * input.taxAmount
  );
}

export function buildImmediatePeppolInvoiceData(input: {
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  fulfillment: ReceiptFulfillmentDetails | null;
  items: ImmediateInvoiceOrderItem[];
  merchant: {
    bank_account_name?: string | null;
    bank_account_number?: string | null;
    bank_name?: string | null;
    business_name: string;
    cac_rc_number?: string | null;
    legal_entity_name?: string | null;
    logo_url?: string | null;
    registered_address?: InvoiceData['merchant']['registered_address'] | null;
    support_email?: string | null;
    support_phone?: string | null;
    tax_identification_number?: string | null;
    vat_rate?: number | null;
    vat_registration_status?: string | null;
  };
  notes?: string;
  order: Record<string, unknown>;
  orderNumber: string;
  orderShippingFee: number;
  orderSubtotal: number;
  orderTotal: number;
  paymentAccount: ReceiptOrder['virtual_account'];
  paymentMethod?: string;
  isPaid?: boolean;
  paymentStatus?: string | null;
  amountPaid?: number | null;
  shippingAddress: OrderCreateInput['shipping_address'];
}): InvoiceData {
  const taxAmount = Number(input.order.tax_amount || 0);
  const discountAmount = Number(input.order.discount_amount || 0);
  const currency =
    typeof input.order.currency === 'string' && input.order.currency
      ? input.order.currency
      : 'NGN';
  const vatCategoryCode =
    input.merchant.vat_registration_status === 'registered' || taxAmount > 0
      ? 'S'
      : 'O';
  const vatRate =
    vatCategoryCode === 'S' ? (input.merchant.vat_rate ?? 7.5) : 0;
  const lineExtensionTotal = input.items.reduce(
    (total, item) => total + getOrderItemLineExtensionAmount(item),
    0
  );
  const hasDeviceItem = input.items.some((item) =>
    isDeviceReceiptItemName(getOrderItemBaseName(item))
  );
  const paymentAccount =
    input.paymentAccount ||
    (input.merchant.bank_account_number
      ? {
          account_number: input.merchant.bank_account_number,
          account_name:
            input.merchant.bank_account_name ||
            input.merchant.business_name ||
            undefined,
          bank_name: input.merchant.bank_name || undefined,
        }
      : null);
  let allocatedTaxAmount = 0;

  const invoiceItems: InvoiceLineItem[] = input.items.map((item, index) => {
    const itemAssuranceFee = getOrderItemAssuranceFee(item);
    const lineExtensionAmount = getOrderItemLineExtensionAmount(item);
    const persistedVatAmount = toFiniteNumber(item.vat_amount);
    const vatAmount =
      persistedVatAmount ??
      allocateLineTax({
        index,
        itemCount: input.items.length,
        lineExtensionAmount,
        lineExtensionTotal,
        taxAmount,
        allocatedTaxAmount,
      });
    allocatedTaxAmount += vatAmount;

    const persistedDescription =
      typeof item.item_description === 'string' &&
      item.item_description.trim().length > 0
        ? item.item_description.trim()
        : undefined;
    const itemDescription = appendReceiptFulfillmentDescription({
      description:
        persistedDescription ??
        getOrderItemVariantLabel(item, { includeConditionFallback: false }) ??
        undefined,
      fulfillment: input.fulfillment,
      hasDeviceItem,
      index,
      itemName: getOrderItemBaseName(item),
    });
    const description = itemAssuranceFee
      ? `${itemDescription ? `${itemDescription} ` : ''}Includes device assurance fee (${currency} ${itemAssuranceFee.toFixed(2)}).`
      : itemDescription;

    return {
      line_id: index + 1,
      product_id: getOrderItemProductId(item),
      name: getOrderItemDisplayName(item),
      description,
      quantity: item.quantity,
      unit_code: item.unit_code || 'EA',
      price: getOrderItemUnitPrice(item),
      line_extension_amount: lineExtensionAmount,
      vat_category_code: item.vat_category_code || vatCategoryCode,
      vat_rate: item.vat_rate ?? vatRate,
      vat_amount: vatAmount,
      sellers_item_id: item.sellers_item_id || undefined,
    };
  });
  const taxExclusiveAmount = Math.max(
    0,
    input.orderSubtotal + input.orderShippingFee - discountAmount
  );
  const taxSubtotals: TaxSubtotal[] = [
    {
      vat_category_code: vatCategoryCode,
      vat_rate: vatRate,
      taxable_amount: taxExclusiveAmount,
      tax_amount: taxAmount,
      exemption_reason:
        vatCategoryCode === 'O' ? 'Seller is not VAT registered' : undefined,
    },
  ];
  const issueDate = getImmediateInvoiceIssueDate(input.order);

  return {
    invoice_number: input.orderNumber,
    // Same classification as the invoice download route: unpaid invoice
    // orders are proforma (325), everything else stays commercial (380).
    // Prior-payment evidence (partially_paid status, credited amount_paid)
    // keeps partially covered invoices commercial.
    invoice_type_code: resolveInvoiceTypeCode({
      paymentMethod: input.paymentMethod,
      isPaid: input.isPaid ?? false,
      paymentStatus: input.paymentStatus,
      amountPaid: input.amountPaid,
      storedTypeCode: undefined,
    }),
    issue_date: issueDate,
    due_date: getImmediateInvoiceDueDate(input.order),
    currency,
    buyer_reference: input.customerEmail || input.customerName,
    merchant: {
      business_name: input.merchant.business_name,
      legal_entity_name: input.merchant.legal_entity_name || undefined,
      tax_identification_number:
        input.merchant.tax_identification_number || undefined,
      cac_rc_number: input.merchant.cac_rc_number || undefined,
      vat_registration_status:
        input.merchant.vat_registration_status || 'not_registered',
      vat_rate: input.merchant.vat_rate ?? vatRate,
      registered_address: input.merchant.registered_address || undefined,
      support_email: input.merchant.support_email || undefined,
      support_phone: input.merchant.support_phone || undefined,
      logo_url: input.merchant.logo_url || undefined,
    },
    customer: {
      name: input.customerName,
      email: input.customerEmail || undefined,
      phone: input.customerPhone || undefined,
      address: input.shippingAddress
        ? {
            street: input.shippingAddress.address,
            city: input.shippingAddress.city,
            state: input.shippingAddress.state,
            country:
              input.shippingAddress.countryCode ||
              input.shippingAddress.country ||
              'NG',
          }
        : undefined,
    },
    items: invoiceItems,
    tax_subtotals: taxSubtotals,
    subtotal: input.orderSubtotal,
    tax_exclusive_amount: taxExclusiveAmount,
    tax_amount: taxAmount,
    tax_inclusive_amount: taxExclusiveAmount + taxAmount,
    shipping_fee: input.orderShippingFee,
    discount_amount: discountAmount,
    total: input.orderTotal,
    amount_paid: Number(input.order.amount_paid || 0),
    notes: input.notes,
    payment_account: paymentAccount
      ? {
          account_number: paymentAccount.account_number,
          account_name: paymentAccount.account_name || undefined,
          bank_name: paymentAccount.bank_name || undefined,
        }
      : undefined,
    firs_irn:
      typeof input.order.firs_irn === 'string'
        ? input.order.firs_irn
        : undefined,
    firs_csid:
      typeof input.order.firs_csid === 'string'
        ? input.order.firs_csid
        : undefined,
  };
}
