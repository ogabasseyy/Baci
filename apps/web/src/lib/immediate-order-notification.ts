import {
  appendReceiptFulfillmentDescription,
  formatCanonicalProductConditionLabel,
  formatOrderItemDisplayName,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  type ReceiptFulfillmentDetails,
  type ReceiptOrder,
} from '@baci/shared';
import { after } from 'next/server';
import { buildImmediateInvoiceMerchant } from '@/lib/build-immediate-invoice-merchant';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
  type OrderConfirmationData,
} from '@/lib/email-templates';
import { formatVariantAttributesLabel } from '@/lib/format-variant-attributes-label';
import type {
  InvoiceData,
  InvoiceLineItem,
  TaxSubtotal,
} from '@/lib/invoice-generator';
import { mergeReceiptItemsWithInvoiceMetadata } from '@/lib/invoice-receipt-item-metadata';
import { logger } from '@/lib/logger';
import { dispatchOrderCreationNotifications } from '@/lib/order-notification-dispatch';
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
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { createAdminClient } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/zeptomail';
import type { OrderCreateInput } from '@/schemas/orders';

type OrderCreateItem = OrderCreateInput['items'][number];

type ImmediateInvoiceOrderItem = Omit<OrderCreateItem, 'assurance_fee'> & {
  assurance_fee?: number;
  item_description?: string | null;
  line_extension_amount?: number | null;
  sellers_item_id?: string | null;
  unit_code?: string | null;
  variant_name?: string | null;
  vat_amount?: number | null;
  vat_category_code?: string | null;
  vat_rate?: number | null;
};
type PersistedInvoiceOrderItemRow = {
  assurance_fee?: unknown;
  condition?: unknown;
  has_assurance?: unknown;
  id?: unknown;
  item_description?: unknown;
  line_extension_amount?: unknown;
  name?: unknown;
  price?: unknown;
  product_id?: unknown;
  quantity?: unknown;
  sellers_item_id?: unknown;
  unit_code?: unknown;
  variant_attributes?: unknown;
  variant_id?: unknown;
  variant_name?: unknown;
  vat_amount?: unknown;
  vat_category_code?: unknown;
  vat_rate?: unknown;
};

export const SERVER_ASSURANCE_RATE = DEFAULT_ASSURANCE_RATE;
const IMMEDIATE_INVOICE_DUE_DAYS = 14;
const PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS = 3;
const PERSISTED_INVOICE_ITEMS_RETRY_DELAY_MS = 50;

/**
 * Order row shape the immediate-notification lifecycle reads. The
 * create-RPC row carries no currency column, so callers stamp the
 * currency explicitly alongside it.
 */
export interface ImmediateNotificationOrder {
  id: string;
  tracking_token?: string | null;
  amount_paid?: number | string | null;
  payment_status?: string | null;
  created_at?: string | null;
  total?: number | string | null;
  tax_amount?: number | string | null;
  discount_amount?: number | string | null;
  is_credit_order?: unknown;
  firs_irn?: unknown;
  firs_csid?: unknown;
  currency?: unknown;
  fulfillment_details?: unknown;
  [key: string]: unknown;
}

export interface ImmediateNotificationMerchant {
  business_name: string;
  slug: string;
  phone?: string | null;
  email?: string | null;
  support_email?: string | null;
  email_sender_name?: string | null;
  tax_identification_number?: string | null;
  cac_rc_number?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_name?: string | null;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  registered_address?: InvoiceData['merchant']['registered_address'] | null;
  support_phone?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}

export interface ResolvedImmediateOrderEmail {
  documentKind: 'confirmation' | 'proforma' | 'payment_request';
  isPaidForEmail: boolean;
  subject: string;
}

export interface ImmediateOrderNotificationContext {
  supabase: ReturnType<typeof createClient>;
  order: ImmediateNotificationOrder;
  orderNum: string;
  merchant: ImmediateNotificationMerchant;
  merchantId: string;
  customerId?: string | null;
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  effectivePaymentMethod: string;
  /** Request payment_status (pre-coverage); the order row may differ. */
  paymentStatus?: string | null;
  orderTotal: number;
  orderSubtotal: number;
  orderShippingFee: number;
  orderCurrency: string;
  amountDueToGateway: number;
  savingsAmountUsed: number;
  walletAmountUsed: number;
  isWalletFullyPaid: boolean;
  isQuizVoucherFullyPaid: boolean;
  idempotencyReplayed: boolean;
  emailData: OrderConfirmationData;
  immediateEmail: ResolvedImmediateOrderEmail;
  replyToEmail: string;
  senderName?: string;
  paymentLink: string;
  notes?: string;
  shippingAddress: OrderCreateInput['shipping_address'];
}

export function getOrderItemProductId(
  item: OrderCreateItem
): string | undefined {
  return item.product_id || item.productId || item.id;
}

export function getOrderItemCondition(item: {
  condition?: string | null;
}): string | null {
  return item.condition || null;
}

export function getOrderItemBaseName(item: {
  name?: string;
  productName?: string;
}): string {
  return item.name || item.productName || 'Product';
}

export function getOrderItemVariantLabel(
  item: {
    condition?: string | null;
    variantAttributes?: Record<string, string>;
    variant_attributes?: Record<string, string>;
    variantName?: string | null;
    variant_name?: unknown;
  },
  options: { includeConditionFallback?: boolean } = {}
): string | null {
  const variantName = item.variantName || item.variant_name;
  if (typeof variantName === 'string' && variantName.trim().length > 0) {
    return variantName.trim();
  }

  const label = formatVariantAttributesLabel(
    item.variantAttributes || item.variant_attributes
  );

  if (label) {
    return label;
  }

  return options.includeConditionFallback === false
    ? null
    : (formatCanonicalProductConditionLabel(item.condition) ?? null);
}

export function getOrderItemDisplayName(item: {
  condition?: string | null;
  name?: string;
  productName?: string;
  variantAttributes?: Record<string, string>;
  variant_attributes?: Record<string, string>;
  variantName?: string | null;
  variant_name?: unknown;
}) {
  return formatOrderItemDisplayName({
    baseName: getOrderItemBaseName(item),
    condition: getOrderItemCondition(item),
    variantName: getOrderItemVariantLabel(item),
  });
}

export function toFiniteNumber(value: unknown): number | null {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function getStringRecord(
  value: unknown
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entryValue]) =>
      typeof entryValue === 'string' ? [key, entryValue] : null
    )
    .filter((entry): entry is [string, string] => entry !== null);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function getOrderItemUnitPrice(item: OrderCreateItem) {
  return item.negotiatedPrice ?? item.price;
}

export function getOrderFulfillmentDetails(
  order: Record<string, unknown>
): ReceiptFulfillmentDetails | null {
  return normalizeReceiptFulfillmentDetails(order.fulfillment_details);
}

export function buildImmediateInvoiceShippingAddress(
  shippingAddress: OrderCreateInput['shipping_address']
): ReceiptOrder['shipping_address'] {
  if (!shippingAddress) {
    return null;
  }

  return {
    address_line1: shippingAddress.address,
    city: shippingAddress.city,
    state: shippingAddress.state,
    postal_code: shippingAddress.postalCode,
    country: shippingAddress.countryCode || shippingAddress.country || 'NG',
  };
}

export function getImmediateInvoiceIssueDate(order: Record<string, unknown>) {
  return new Date(
    typeof order.created_at === 'string' ? order.created_at : Date.now()
  );
}

export function getImmediateInvoiceDueDate(order: Record<string, unknown>) {
  const issueDate = getImmediateInvoiceIssueDate(order);

  return new Date(
    issueDate.getTime() + IMMEDIATE_INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000
  );
}

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

function normalizePersistedInvoiceOrderItems(
  rows: unknown
): ImmediateInvoiceOrderItem[] | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const normalizedItems = rows
    .map((row): ImmediateInvoiceOrderItem | null => {
      if (!row || typeof row !== 'object') {
        return null;
      }

      const typedRow = row as PersistedInvoiceOrderItemRow;
      const quantity = toFiniteNumber(typedRow.quantity);
      const price = toFiniteNumber(typedRow.price);
      const name = getOptionalString(typedRow.name) ?? 'Product';
      const fallbackIdentifier =
        getOptionalString(typedRow.product_id) ??
        getOptionalString(typedRow.id);

      if (!quantity || quantity <= 0 || price === null || price < 0) {
        return null;
      }

      return {
        condition: getOptionalString(typedRow.condition) ?? undefined,
        id: fallbackIdentifier,
        product_id: getOptionalString(typedRow.product_id),
        productName: undefined,
        name,
        quantity,
        price,
        variant_id: getOptionalString(typedRow.variant_id),
        variantName: undefined,
        variant_attributes: getStringRecord(typedRow.variant_attributes),
        has_assurance: typedRow.has_assurance === true,
        assurance_fee: toFiniteNumber(typedRow.assurance_fee) ?? undefined,
        item_description: getOptionalString(typedRow.item_description) ?? null,
        line_extension_amount: toFiniteNumber(typedRow.line_extension_amount),
        sellers_item_id: getOptionalString(typedRow.sellers_item_id) ?? null,
        unit_code: getOptionalString(typedRow.unit_code) ?? null,
        variant_name: getOptionalString(typedRow.variant_name) ?? undefined,
        vat_amount: toFiniteNumber(typedRow.vat_amount),
        vat_category_code:
          getOptionalString(typedRow.vat_category_code) ?? null,
        vat_rate: toFiniteNumber(typedRow.vat_rate),
      };
    })
    .filter((item): item is ImmediateInvoiceOrderItem => item !== null);

  return normalizedItems.length > 0 ? normalizedItems : null;
}

async function delayPersistedInvoiceItemRetry(attempt: number) {
  await new Promise((resolve) =>
    setTimeout(resolve, attempt * PERSISTED_INVOICE_ITEMS_RETRY_DELAY_MS)
  );
}

export async function loadPersistedInvoiceOrderItems({
  orderId,
  supabase,
}: {
  orderId: string;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  let lastError: unknown = null;

  for (
    let attempt = 1;
    attempt <= PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS;
    attempt += 1
  ) {
    const { data, error } = await supabase
      .from('order_items')
      .select(
        'id, product_id, variant_id, variant_attributes, variant_name, condition, name, quantity, price, has_assurance, assurance_fee, item_description, line_extension_amount, vat_category_code, vat_rate, vat_amount, sellers_item_id, unit_code'
      )
      .eq('order_id', orderId)
      .order('line_id', { ascending: true });

    if (!error) {
      const normalizedItems = normalizePersistedInvoiceOrderItems(data);
      if (normalizedItems) {
        return normalizedItems;
      }

      lastError = new Error('Persisted invoice items not visible yet');
      if (attempt < PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS) {
        await delayPersistedInvoiceItemRetry(attempt);
        continue;
      }

      return null;
    }

    lastError = error;
    logger.error({
      message: 'Failed to load persisted order items for invoice email',
      alert: 'invoice_order_items_lookup_failed',
      attempt,
      attempts: PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS,
      orderId,
      error,
    });

    if (attempt < PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS) {
      await delayPersistedInvoiceItemRetry(attempt);
    }
  }

  logger.error({
    message: 'Persisted order item lookup exhausted for invoice email',
    alert: 'invoice_order_items_lookup_exhausted',
    attempts: PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS,
    orderId,
    error: lastError,
  });
  return null;
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

/**
 * Amount already covered by credit/partial payment: the same
 * credited-balance rule feeds the email transfer instructions, the
 * attached PDF, and the DVA skip guard, so credit already applied is
 * never charged again.
 */
export function getCreditedAmountPaid(
  order: ImmediateNotificationOrder,
  savingsAmountUsed: number,
  walletAmountUsed: number
) {
  return Math.max(
    Number(order.amount_paid || 0),
    savingsAmountUsed + walletAmountUsed
  );
}

export function getImmediateEmailAmountDue(
  orderTotal: number,
  creditedAmountPaid: number
) {
  return Math.max(orderTotal - creditedAmountPaid, 0);
}

export interface PreResponsePayformeProvisioning {
  virtualAccount: ReceiptOrder['virtual_account'];
  attempted: boolean;
}

/**
 * Pay for Me DVA provisioned BEFORE the response (not in after()): the
 * requester navigates straight to the success page, whose single order
 * lookup must already carry the bank account. Uses the request-scoped
 * client (proof-bound RPC, never service-role). Skipped on replay: the
 * DVA was provisioned by the original attempt.
 */
export async function provisionPreResponsePayformeDva(
  ctx: ImmediateOrderNotificationContext
): Promise<PreResponsePayformeProvisioning> {
  const { order, supabase } = ctx;
  const creditedPaid = getCreditedAmountPaid(
    order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  if (
    ctx.effectivePaymentMethod !== 'payforme' ||
    ctx.idempotencyReplayed ||
    getImmediateEmailAmountDue(ctx.orderTotal, creditedPaid) <= 0
  ) {
    return { virtualAccount: null, attempted: false };
  }
  try {
    const preResponseOutcome = await provisionInvoiceMethodDva({
      persistAssignment: (assignment) =>
        persistPaystackDvaAssignment(supabase, assignment),
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      customerPhone: ctx.customerPhone ?? null,
      merchantPhone: ctx.merchant.phone ?? null,
      orderId: order.id,
      expiresAt: getImmediateInvoiceDueDate(
        order as Record<string, unknown>
      ).toISOString(),
      orderCurrency: ctx.orderCurrency,
      orderLabel: 'payforme',
    });
    if (preResponseOutcome.outcome === 'provisioned') {
      return {
        virtualAccount: preResponseOutcome.virtualAccount,
        attempted: true,
      };
    }
    if (preResponseOutcome.outcome === 'failed') {
      // Retryable provider failure (handled error or deadline): allow
      // the in-after branch one retry so the request email can still
      // carry transfer details. Definitive skips and uncertain
      // persistence stay suppressed.
      return { virtualAccount: null, attempted: false };
    }
    return { virtualAccount: null, attempted: true };
  } catch (error) {
    // Unexpected failure (not a discriminated outcome): allow the
    // in-after branch one retry so the request email can still carry
    // transfer details.
    logger.error({
      message:
        'Pre-response Pay for Me DVA provisioning threw; will retry post-response',
      orderId: order.id,
      error: error instanceof Error ? error.message : error,
    });
    return { virtualAccount: null, attempted: false };
  }
}

export interface ImmediateInvoiceArtifacts {
  attachments:
    | Array<{ name: string; content: string; mime_type: string }>
    | undefined;
  emailedInvoiceTypeCode: string | undefined;
  invoiceVirtualAccount: ReceiptOrder['virtual_account'];
}

/**
 * Invoice-only artifacts rendered post-response: persisted canonical
 * items, the invoice-method DVA, the branded PDF (plus Peppol UBL XML
 * for commercial invoices), and the initial reminder row. Throws
 * PERSISTED_INVOICE_ITEMS_UNAVAILABLE when the canonical items cannot
 * be loaded — the caller still renders the email without artifacts.
 */
export async function buildImmediateInvoiceArtifacts(
  ctx: ImmediateOrderNotificationContext
): Promise<ImmediateInvoiceArtifacts> {
  const { order, orderNum, merchant } = ctx;
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
  let backgroundSupabase: ReturnType<typeof createAdminClient> | null = null;

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
    backgroundSupabase ??= createAdminClient();
    const persistedInvoiceItems = await loadPersistedInvoiceOrderItems({
      orderId: order.id,
      supabase: backgroundSupabase,
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
      backgroundSupabase ??= createAdminClient();
      const invoiceDvaSupabase = backgroundSupabase;
      const invoiceOutcome = await provisionInvoiceMethodDva({
        persistAssignment: (assignment) =>
          persistPaystackDvaAssignment(invoiceDvaSupabase, assignment),
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
    const receiptOrder: ReceiptOrder = {
      order_number: orderNum,
      created_at: String(order.created_at || new Date().toISOString()),
      currency: ctx.orderCurrency,
      total: ctx.orderTotal,
      subtotal: ctx.orderSubtotal,
      shipping_fee: ctx.orderShippingFee,
      tax_amount: Number(order.tax_amount || 0),
      discount_amount: Number(order.discount_amount || 0),
      amount_paid: amountPaid,
      balance: Math.max(ctx.orderTotal - amountPaid, 0),
      payment_status: ctx.immediateEmail.isPaidForEmail
        ? 'paid'
        : order.payment_status || ctx.paymentStatus || 'unpaid',
      payment_method: ctx.effectivePaymentMethod,
      is_credit_order: Boolean(
        (order as Record<string, unknown>).is_credit_order
      ),
      customer_name: ctx.customerName,
      customer_email: ctx.customerEmail,
      customer_phone: ctx.customerPhone || null,
      shipping_address: buildImmediateInvoiceShippingAddress(
        ctx.shippingAddress
      ),
      virtual_account: invoiceVirtualAccount,
      fulfillment_details: fulfillment,
      items: invoiceItems.map((item, index) => {
        const variantName = getOrderItemVariantLabel(item, {
          includeConditionFallback: false,
        });

        return {
          line_id: index + 1,
          product_id: item.product_id || null,
          product_name: getOrderItemBaseName(item),
          condition: getOrderItemCondition(item),
          variant_id: item.variant_id || null,
          variant_name: variantName || undefined,
          description: appendReceiptFulfillmentDescription({
            description: undefined,
            fulfillment,
            hasDeviceItem,
            index,
            itemName: getOrderItemBaseName(item),
          }),
          quantity: item.quantity,
          price: item.negotiatedPrice ?? item.price,
        };
      }),
      transactions: [],
    };
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

    // Log standard initial reminder row in order_reminders
    backgroundSupabase ??= createAdminClient();
    const { error: reminderInsertError } = await backgroundSupabase
      .from('order_reminders')
      .insert({
        order_id: order.id,
        channel: 'email',
        payment_link: ctx.paymentLink,
      });

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

/**
 * In-after Pay for Me provisioning: reuses the pre-response DVA when
 * one was persisted, retries once when the pre-response attempt never
 * ran, and never provisions a second account. Skipped for zero-due
 * orders and invoice-method checkouts (which provision above).
 */
export async function provisionPayformeRetryDva(
  ctx: ImmediateOrderNotificationContext,
  preResponse: PreResponsePayformeProvisioning
): Promise<ReceiptOrder['virtual_account']> {
  const { order, supabase } = ctx;
  const creditedPaid = getCreditedAmountPaid(
    order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  if (
    ctx.effectivePaymentMethod !== 'payforme' ||
    getImmediateEmailAmountDue(ctx.orderTotal, creditedPaid) <= 0
  ) {
    return null;
  }
  if (preResponse.virtualAccount) {
    // Pre-response provisioning already persisted the DVA the success
    // page looked up: reuse it, never provision a second account for
    // the same order.
    return preResponse.virtualAccount;
  }
  if (preResponse.attempted) {
    // The pre-response attempt ran and yielded nothing (non-NGN skip or
    // Paystack/persistence failure, already logged) — no retry, since a
    // second Paystack call cannot fix a definitive skip and would orphan
    // a second virtual account on persistence failure.
    return null;
  }
  try {
    const retryOutcome = await provisionInvoiceMethodDva({
      persistAssignment: (assignment) =>
        persistPaystackDvaAssignment(supabase, assignment),
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      customerPhone: ctx.customerPhone ?? null,
      merchantPhone: ctx.merchant.phone ?? null,
      orderId: order.id,
      expiresAt: getImmediateInvoiceDueDate(
        order as Record<string, unknown>
      ).toISOString(),
      orderCurrency: ctx.orderCurrency,
      orderLabel: 'payforme',
    });
    return retryOutcome.outcome === 'provisioned'
      ? retryOutcome.virtualAccount
      : null;
  } catch (error) {
    logger.error({
      message:
        'Failed to provision Pay for Me DVA; sending request email without transfer details',
      orderId: order.id,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

export interface ImmediateEmailSendInput {
  attachments:
    | Array<{ name: string; content: string; mime_type: string }>
    | undefined;
  invoiceVirtualAccount: ReceiptOrder['virtual_account'];
}

/**
 * Renders the immediate order email AFTER provisioning, so the proforma
 * body carries the provisioned DVA as bank-transfer payment
 * instructions, and sends it fire-and-forget (callers invoke inside
 * after()). A credited-but-unpaid invoice stays a commercial
 * confirmation yet still receives residual-balance transfer
 * instructions.
 */
export async function sendImmediateOrderConfirmationEmail(
  ctx: ImmediateOrderNotificationContext,
  artifacts: ImmediateEmailSendInput
): Promise<void> {
  const creditedPaid = getCreditedAmountPaid(
    ctx.order,
    ctx.savingsAmountUsed,
    ctx.walletAmountUsed
  );
  const emailAmountDue = getImmediateEmailAmountDue(
    ctx.orderTotal,
    creditedPaid
  );
  const emailVirtualAccount = artifacts.invoiceVirtualAccount
    ? {
        accountName: artifacts.invoiceVirtualAccount.account_name,
        accountNumber: artifacts.invoiceVirtualAccount.account_number,
        bankName: artifacts.invoiceVirtualAccount.bank_name,
      }
    : undefined;
  const emailBalanceDueInstructions =
    ctx.effectivePaymentMethod === 'invoice' &&
    ctx.immediateEmail.documentKind === 'confirmation' &&
    !ctx.immediateEmail.isPaidForEmail &&
    emailAmountDue > 0;
  const htmlContent = generateOrderConfirmationEmail({
    ...ctx.emailData,
    documentKind: ctx.immediateEmail.documentKind,
    amountDue: emailAmountDue,
    virtualAccount: emailVirtualAccount,
    balanceDueInstructions: emailBalanceDueInstructions,
  });
  const textContent = generateOrderConfirmationText({
    ...ctx.emailData,
    documentKind: ctx.immediateEmail.documentKind,
    amountDue: emailAmountDue,
    virtualAccount: emailVirtualAccount,
    balanceDueInstructions: emailBalanceDueInstructions,
  });
  const emailResult = await sendEmail({
    to: ctx.customerEmail,
    toName: ctx.customerName,
    // Derived from the payment/paid classification (same rule as the
    // body and the Peppol type code, which share isPaidForEmail): the
    // attachment block above may fail, leaving the emailed type code
    // undefined, and the subject must not flip to commercial on that
    // failure.
    subject: ctx.immediateEmail.subject,
    htmlContent,
    textContent,
    replyTo: ctx.replyToEmail,
    emailType: 'orders',
    fromName: ctx.senderName,
    attachments: artifacts.attachments,
    auditContext: {
      merchantId: ctx.merchantId,
      orderId: ctx.order.id,
      customerId: ctx.customerId,
      metadata: {
        trigger: 'order_create_immediate_confirmation',
        paymentMethod: ctx.effectivePaymentMethod,
      },
    },
  });

  if (!emailResult.success) {
    logger.error({
      message: 'Failed to send order confirmation email',
      orderId: ctx.order.id,
      paymentMethod: ctx.effectivePaymentMethod,
      emailError: emailResult.error,
      emailErrorCode: emailResult.errorCode,
      emailErrorDetails: emailResult.errorDetails,
    });
  } else {
    logger.info({
      message: 'Order confirmation email sent',
      orderId: ctx.order.id,
      paymentMethod: ctx.effectivePaymentMethod,
      messageId: emailResult.messageId,
    });
  }
}

export interface MerchantOrderNotificationContext {
  supabase: ReturnType<typeof createClient>;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderTotal: number;
  orderCurrency: string;
  paymentMethod: string;
  paymentStatus?: string | null;
  invoiceBalanceDue: number;
  isWalletFullyPaid: boolean;
}

/**
 * Merchant new-order/invoice notification, fire-and-forget. Queued
 * inside after() by the caller alongside the customer email.
 */
export function queueMerchantOrderNotifications(
  ctx: MerchantOrderNotificationContext
) {
  after(() =>
    dispatchOrderCreationNotifications({
      merchantId: ctx.merchantId,
      orderId: ctx.orderId,
      orderNumber: ctx.orderNumber,
      customerName: ctx.customerName,
      orderTotal: ctx.orderTotal,
      orderCurrency: ctx.orderCurrency,
      paymentMethod: ctx.paymentMethod,
      paymentStatus: ctx.paymentStatus,
      invoiceBalanceDue: ctx.invoiceBalanceDue,
      isWalletFullyPaid: ctx.isWalletFullyPaid,
      preferenceClient: ctx.supabase,
    })
  );
}
