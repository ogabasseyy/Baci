import {
  appendReceiptFulfillmentDescription,
  formatCanonicalProductConditionLabel,
  formatOrderItemDisplayName,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  type ReceiptFulfillmentDetails,
  type ReceiptMerchant,
  type ReceiptOrder,
} from '@baci/shared';
import { cookies } from 'next/headers';
import { after, type NextRequest, NextResponse } from 'next/server';
import { getQuizPhaseEnv, getQuizProductionApprovedEnv } from '@/env';
import {
  computeAgenticOrderTax,
  isTaxComputeUuidError,
} from '@/lib/agentic/checkout-order-tax';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { addStorefrontOrderLineOrdinals } from '@/lib/checkout/add-storefront-order-line-ordinals';
import { buildTransactionDiscountAdTracking } from '@/lib/checkout/build-transaction-discount-ad-tracking';
import {
  CanonicalOrderSubtotalLoadError,
  computeCanonicalOrderSubtotal,
  isCanonicalOrderSubtotalUuidError,
} from '@/lib/checkout/canonical-order-subtotal';
import { prepareCheckoutIdempotencyReplay } from '@/lib/checkout/checkout-idempotency-replay';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import type { createTransactionDiscountProof } from '@/lib/checkout/create-transaction-discount-proof';
import { createTransactionDiscountProofForCheckout } from '@/lib/checkout/create-transaction-discount-proof-for-checkout';
import { computeDiscountAmountForSubtotal } from '@/lib/checkout/discount-amount';
import { hasExistingMerchantRateOrder } from '@/lib/checkout/has-existing-merchant-rate-order';
import { LocalAirportDeliveryFeeMismatchError } from '@/lib/checkout/local-airport-delivery-fee-mismatch-error';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';
import { computeOrderNegotiationDiscount } from '@/lib/checkout/order-negotiation-discount';
import { persistReplayedDeliveryMetadata } from '@/lib/checkout/persist-replayed-delivery-metadata';
import { scheduleCheckoutProductBlogPurge } from '@/lib/checkout/schedule-checkout-product-blog-purge';
import { selectIdempotencyShippingAddress } from '@/lib/checkout/select-idempotency-shipping-address';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { validateLocalAirportDeliveryFee } from '@/lib/checkout/validate-local-airport-delivery-fee';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { recordPlatformOrderCreatedEvent } from '@/lib/events/record-platform-order-created-event';
import { hasPriceNegotiationEntitlement } from '@/lib/feature-flags';
import { formatVariantAttributesLabel } from '@/lib/format-variant-attributes-label';
import { detectPrivacyRegion } from '@/lib/geo-privacy';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import type {
  InvoiceData,
  InvoiceLineItem,
  TaxSubtotal,
} from '@/lib/invoice-generator';
import { mergeReceiptItemsWithInvoiceMetadata } from '@/lib/invoice-receipt-item-metadata';
import { logger } from '@/lib/logger';
import { dispatchOrderCreationNotifications } from '@/lib/order-notification-dispatch';
import { ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';
import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import { recordPreGatewayRedemption } from '@/lib/payments/record-pre-gateway-redemption';
import { generatePaymentAccount } from '@/lib/paystack';
import {
  generatePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
} from '@/lib/peppol-ubl-invoice';
import {
  enforcePrizeProductionGuard,
  QuizProductionNotApprovedError,
} from '@/lib/quiz-compliance-gate';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';
import { verifyQuizVoucherToken } from '@/lib/quiz-voucher-token';
import { getClientIdentifier } from '@/lib/rate-limit';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { sanitizeLikePattern, sanitizeSearchQuery } from '@/lib/sanitize-core';
import { toInternationalQuoteValidationItemsFromOrder } from '@/lib/shipping/international-shipment-items';
import {
  getMerchantShippingRates,
  MerchantShippingRatesLoadError,
} from '@/lib/shipping/merchant-rates/get-merchant-shipping-rates';
import type {
  MerchantPickupAddress,
  MerchantRateKind,
} from '@/lib/shipping/merchant-rates/types';
import { verifyOrderShippingRate } from '@/lib/shipping/merchant-rates/verify-order-shipping-rate';
import { normalizeMerchantRateOrderAddress } from '@/lib/shipping/normalize-merchant-rate-order-address';
import {
  enrichShippingAddressWithQuoteDestination,
  OrderQuoteDestinationMismatchError,
} from '@/lib/shipping/order-quote-destination';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/zeptomail';
import { type OrderCreateInput, orderCreateSchema } from '@/schemas/orders';
import { storefrontDiscountCodeRowSchema } from '@/schemas/storefront-discount';

function isPayOnDelivery(paymentMethod: string): boolean {
  return paymentMethod === 'pod' || paymentMethod === 'pay_on_delivery';
}

function getRequestIdempotencyKey(request: NextRequest) {
  const headerValue = request.headers.get('idempotency-key')?.trim();
  return headerValue ? headerValue : null;
}

function getSavingsRedemptionIdempotencyKey({
  customerEmail,
  items,
  merchantId,
  requestIdempotencyKey,
  savingsAmount,
  savingsGoalId,
}: {
  customerEmail: string;
  items: Array<{
    product_id: string;
    quantity: number;
    variant_id?: string | null;
  }>;
  merchantId: string;
  requestIdempotencyKey: string | null;
  savingsAmount: number;
  savingsGoalId: string;
}) {
  if (requestIdempotencyKey) {
    return `order:${requestIdempotencyKey}:savings`;
  }

  const itemFingerprint = items
    .map(
      (item) => `${item.product_id}:${item.variant_id ?? ''}:${item.quantity}`
    )
    .join('|');
  return [
    'order_savings',
    merchantId,
    customerEmail.toLowerCase(),
    savingsGoalId,
    savingsAmount,
    itemFingerprint,
  ].join(':');
}

/** Server-authoritative assurance rate — never trust the client value. */
const SERVER_ASSURANCE_RATE = DEFAULT_ASSURANCE_RATE;
// Imported from @/lib/feature-flags

type EmailOrderItem = {
  condition?: string | null;
  name?: string;
  productName?: string;
  quantity?: number;
  price?: number;
  variantAttributes?: Record<string, string>;
  variant_attributes?: Record<string, string>;
  variantName?: string | null;
  variant_name?: string | null;
};

type QuizVoucherItemCandidate = {
  voucherAwardId?: unknown;
  voucherToken?: unknown;
  voucher_award_id?: unknown;
  voucher_token?: unknown;
};
type OrderCreateItem = OrderCreateInput['items'][number];
type OrderQuoteValidationPayloadItem = {
  price?: number | string | null;
  product_id?: string | null;
  quantity: number;
};
type OrderQuoteValidationProductRow = {
  commodity_code?: string | null;
  dimensions?: unknown;
  id: string;
  name: string | null;
  weight_unit?: string | null;
  weight_value?: number | string | null;
};
type VoucherPaymentStatusItem = {
  assurance_fee?: number | string | null;
  price: number | string;
  quantity: number | string;
};
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

const IMMEDIATE_INVOICE_DUE_DAYS = 14;
const PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS = 3;
const PERSISTED_INVOICE_ITEMS_RETRY_DELAY_MS = 50;

function hasNonEmptyVoucherIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasQuizVoucherIdentifier(item: QuizVoucherItemCandidate): boolean {
  return (
    hasNonEmptyVoucherIdentifier(item.voucher_award_id) ||
    hasNonEmptyVoucherIdentifier(item.voucherAwardId) ||
    hasNonEmptyVoucherIdentifier(item.voucher_token) ||
    hasNonEmptyVoucherIdentifier(item.voucherToken)
  );
}

function hasQuizVoucherItem(items: QuizVoucherItemCandidate[]): boolean {
  return items.some((item) => hasQuizVoucherIdentifier(item));
}

function hasNonQuizVoucherItem(items: QuizVoucherItemCandidate[]): boolean {
  return items.some((item) => !hasQuizVoucherIdentifier(item));
}

function getQuizVoucherToken(item: QuizVoucherItemCandidate): string | null {
  if (hasNonEmptyVoucherIdentifier(item.voucher_token)) {
    return item.voucher_token.trim();
  }

  if (hasNonEmptyVoucherIdentifier(item.voucherToken)) {
    return item.voucherToken.trim();
  }

  return null;
}

function getOrderItemProductId(item: OrderCreateItem): string | undefined {
  return item.product_id || item.productId || item.id;
}

function getOrderItemVariantId(item: OrderCreateItem): string | null {
  return item.variantId || item.variant_id || null;
}

function getOrderItemCondition(item: {
  condition?: string | null;
}): string | null {
  return item.condition || null;
}

function getOrderItemBaseName(item: {
  name?: string;
  productName?: string;
}): string {
  return item.name || item.productName || 'Product';
}

function getOrderItemVariantLabel(
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

function getOrderItemDisplayName(item: {
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

function getOrderFulfillmentDetails(
  order: Record<string, unknown>
): ReceiptFulfillmentDetails | null {
  return normalizeReceiptFulfillmentDetails(order.fulfillment_details);
}

function toReceiptRecord<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as T;
}

function buildImmediateInvoiceMerchant(merchant: {
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  brand_colors?: unknown;
  business_address?: string | null;
  business_name?: string | null;
  cac_rc_number?: string | null;
  email?: string | null;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  pages?: unknown;
  phone?: string | null;
  registered_address?: unknown;
  social_media?: unknown;
  support_email?: string | null;
  support_phone?: string | null;
  tax_identification_number?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}): ReceiptMerchant {
  return {
    business_name: merchant.business_name || null,
    logo_url: merchant.logo_url || null,
    email: merchant.email || merchant.support_email || '',
    phone: merchant.phone || null,
    support_email: merchant.support_email || null,
    support_phone: merchant.support_phone || null,
    business_address: merchant.business_address || null,
    registered_address: toReceiptRecord<ReceiptMerchant['registered_address']>(
      merchant.registered_address
    ),
    cac_rc_number: merchant.cac_rc_number || null,
    tax_identification_number: merchant.tax_identification_number || null,
    legal_entity_name: merchant.legal_entity_name || null,
    brand_colors: toReceiptRecord<ReceiptMerchant['brand_colors']>(
      merchant.brand_colors
    ),
    vat_registration_status: merchant.vat_registration_status || null,
    vat_rate: merchant.vat_rate ?? null,
    bank_code: merchant.bank_code || null,
    bank_account_number: merchant.bank_account_number || null,
    bank_name: merchant.bank_name || null,
    bank_account_name: merchant.bank_account_name || null,
    social_media: toReceiptRecord<ReceiptMerchant['social_media']>(
      merchant.social_media
    ),
    pages: toReceiptRecord<ReceiptMerchant['pages']>(merchant.pages),
  };
}

function buildImmediateInvoiceShippingAddress(
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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getImmediateInvoiceIssueDate(order: Record<string, unknown>) {
  return new Date(
    typeof order.created_at === 'string' ? order.created_at : Date.now()
  );
}

function getImmediateInvoiceDueDate(order: Record<string, unknown>) {
  const issueDate = getImmediateInvoiceIssueDate(order);

  return new Date(
    issueDate.getTime() + IMMEDIATE_INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000
  );
}

function toFiniteNumber(value: unknown): number | null {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function getVoucherOrderAmountDueBeforeGateway({
  discountAmount,
  giftWrappingFee,
  items,
  shippingFee,
  taxAmount,
}: {
  discountAmount: number;
  giftWrappingFee: number;
  items: VoucherPaymentStatusItem[];
  shippingFee: number;
  taxAmount: number;
}) {
  const itemsTotal = items.reduce((total, item) => {
    const price = toFiniteNumber(item.price) ?? 0;
    const quantity = toFiniteNumber(item.quantity) ?? 0;
    const assuranceFee = toFiniteNumber(item.assurance_fee) ?? 0;

    return total + price * quantity + assuranceFee;
  }, 0);

  return Math.max(
    roundCurrency(
      itemsTotal + shippingFee + taxAmount + giftWrappingFee - discountAmount
    ),
    0
  );
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
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

function getOrderItemUnitPrice(item: OrderCreateItem) {
  return item.negotiatedPrice ?? item.price;
}

async function buildOrderQuoteValidationItems({
  items,
  merchantId,
  supabase,
}: {
  items: OrderQuoteValidationPayloadItem[];
  merchantId: string;
  supabase: ReturnType<typeof createClient>;
}) {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (productIds.length === 0) {
    return items.map((item) => ({ name: null, quantity: item.quantity }));
  }

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, weight_value, weight_unit, dimensions, commodity_code')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .returns<OrderQuoteValidationProductRow[]>();

  if (error || !products) {
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load products for international quote validation',
      { cause: error ?? undefined },
      (error as { code?: string } | null | undefined)?.code
    );
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  return toInternationalQuoteValidationItemsFromOrder(
    items.map((item) => {
      const product = item.product_id
        ? (productMap.get(item.product_id) ?? null)
        : null;
      return {
        name: product?.name ?? null,
        price: item.price ?? null,
        quantity: item.quantity,
        product,
      };
    }),
    { includeValue: true }
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

async function loadPersistedInvoiceOrderItems({
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

function buildImmediatePeppolInvoiceData(input: {
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
    invoice_type_code: '380',
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

// `rejectedVoucherToken` (when known) lets checkout prune ONLY the failed
// voucher line, so a multi-voucher cart never loses a still-valid prize.
function invalidQuizVoucherTokenResponse(rejectedVoucherToken?: string) {
  return NextResponse.json(
    {
      code: 'QUIZ_VOUCHER_TOKEN_INVALID',
      error: 'Invalid quiz voucher token',
      ...(rejectedVoucherToken ? { rejectedVoucherToken } : {}),
    },
    { status: 400 }
  );
}

function invalidQuizVoucherQuantityResponse() {
  return NextResponse.json(
    {
      code: 'QUIZ_VOUCHER_QUANTITY_INVALID',
      error: 'Quiz voucher items must have quantity 1',
    },
    { status: 400 }
  );
}

// Distinct from an invalid token: the cart holds two-plus individually valid
// prize vouchers but only one can be redeemed per order. Callers show a
// "redeem one at a time" message and must NOT prune the (valid) voucher lines.
function tooManyQuizVouchersResponse() {
  return NextResponse.json(
    {
      code: 'QUIZ_VOUCHER_MULTIPLE',
      error: 'Only one quiz voucher can be redeemed per order',
    },
    { status: 400 }
  );
}

function getQuizVoucherAwardEvent(row: unknown) {
  if (!row || typeof row !== 'object') return null;
  const joined = (row as { quiz_events?: unknown }).quiz_events;
  const event = Array.isArray(joined) ? joined[0] : joined;
  if (!event || typeof event !== 'object') return null;
  const complianceVerified = (event as { compliance_verified?: unknown })
    .compliance_verified;
  const regulatoryBasis = (event as { regulatory_basis?: unknown })
    .regulatory_basis;
  const regulatoryEvidenceRef = (event as { regulatory_evidence_ref?: unknown })
    .regulatory_evidence_ref;
  const regulatoryJurisdiction = (
    event as { regulatory_jurisdiction?: unknown }
  ).regulatory_jurisdiction;

  return {
    complianceVerified: complianceVerified === true,
    regulatoryBasis:
      typeof regulatoryBasis === 'string' ? regulatoryBasis : null,
    regulatoryEvidenceRef:
      typeof regulatoryEvidenceRef === 'string' ? regulatoryEvidenceRef : null,
    regulatoryJurisdiction:
      typeof regulatoryJurisdiction === 'string'
        ? regulatoryJurisdiction
        : null,
  };
}

// Keep the old revision's maximum execution window explicit so deploys can
// wait for every in-flight checkout before enabling the route-context trigger.
export const maxDuration = 60;

// GET /api/orders - Fetch orders for authenticated merchant
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      logger.error({ message: 'API: Auth error or no user', error: authError });
      return NextResponse.json(
        { error: 'Unauthorized: You must be logged in to fetch orders.' },
        { status: 401 }
      );
    }

    // Get merchant record (supports both owners and staff members)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      logger.error({
        message: 'API: Merchant not found for user',
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Merchant not found for the authenticated user.' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'orders', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Get search params for filtering
    const { searchParams } = new URL(request.url);
    const paymentStatus = searchParams.get('payment_status');
    const shippingStatus = searchParams.get('shipping_status');
    const searchRaw = searchParams.get('search');

    // Sanitize search input
    const search = searchRaw ? sanitizeSearchQuery(searchRaw) : null;

    // Build query
    let query = supabase
      .from('orders')
      .select(ORDER_WITH_ITEMS_QUERY)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus);
    }

    if (shippingStatus && shippingStatus !== 'all') {
      query = query.eq('shipping_status', shippingStatus);
    }

    // Search by customer name or order number (with sanitized input)
    if (search?.trim()) {
      const sanitizedPattern = sanitizeLikePattern(search);
      query = query.or(
        `customer_name.ilike.%${sanitizedPattern}%,order_number.ilike.%${sanitizedPattern}%`
      );
    }

    const { data: orders, error: ordersError } = await query;

    if (ordersError) {
      logger.error({ message: 'Error fetching orders', error: ordersError });
      return NextResponse.json(
        { error: 'Failed to fetch orders from the database.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ orders: orders || [] });
  } catch (error) {
    logger.error({ message: 'Unexpected error in GET /api/orders', error });
    return NextResponse.json(
      { error: 'An internal server error occurred.' },
      { status: 500 }
    );
  }
}

// POST /api/orders - Create new order from storefront
// CSRF exemption: This endpoint is called by unauthenticated storefront guests during checkout.
// Guest users do not have CSRF tokens. Abuse is mitigated by rate limiting in proxy.ts,
// Zod validates input shape, while the SECURITY DEFINER RPC enforces merchant + item authorization server-side.
export async function POST(request: NextRequest) {
  try {
    // Optional auth: supports web cookies and mobile Bearer tokens, but still
    // allows guest checkout when authentication is absent.
    const auth = await authenticateApiRequest(request);
    const supabase = auth.supabase ?? createClient(await cookies());
    const user = auth.user;
    const json = await request.json();

    // Capture IP and User Agent for enhanced ad tracking (improves Event Match Quality)
    // Use centralized IP resolution logic to prevent spoofing
    const clientIp = getClientIdentifier(request);
    const clientUserAgent = request.headers.get('user-agent') || undefined;

    // Detect privacy region for CCPA/GDPR compliance (LDU flag)
    const geoPrivacy = await detectPrivacyRegion(clientIp);

    const parseResult = orderCreateSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const body = parseResult.data;

    const {
      merchant_id,
      customer_email,
      customer_name,
      customer_phone,
      items,
      shipping_fee, // Default already handled by Zod
      payment_method,
      payment_status,
      shipping_status,
      shipping_address,
      source,
      notes,
      delivery_method,
      airport_type,
      // Ad tracking data for offline conversions
      ad_tracking,
      // Wallet redemption
      use_wallet_credit,
      wallet_amount,
      use_savings_credit,
      savings_amount,
      savings_goal_id,
      // User ID
      user_id,
    } = body;

    if (user && user_id && user_id !== user.id) {
      return NextResponse.json({ error: 'User mismatch' }, { status: 403 });
    }

    // SECURITY: Only use user_id from authenticated session.
    // Do NOT trust user_id from body if user is unauthenticated (guest).
    const resolvedUserId = user?.id || null;

    const hasVoucherItem = hasQuizVoucherItem(items);
    const requestIdempotencyKey = hasVoucherItem
      ? null
      : getRequestIdempotencyKey(request);
    const verifiedQuizVoucherAwardIdsByIndex = new Map<number, string>();
    // award id → the (first) still-valid signed token that produced it, so a
    // later award-status rejection can name the exact line for checkout to
    // prune instead of stranding the whole cart.
    const verifiedQuizVoucherTokenByAwardId = new Map<string, string>();

    // Phase 1b voucher orders are user-bound. Keep the prize path behind the
    // production guard before any order mutation work.
    if (hasVoucherItem) {
      if (!resolvedUserId) {
        return NextResponse.json(
          {
            error: 'Authentication required for quiz voucher orders',
            code: 'QUIZ_VOUCHER_AUTH_REQUIRED',
          },
          { status: 401 }
        );
      }

      if (
        getQuizPhaseEnv() !== 'production' ||
        !getQuizProductionApprovedEnv()
      ) {
        try {
          enforcePrizeProductionGuard({}, false);
        } catch (error) {
          if (error instanceof QuizProductionNotApprovedError) {
            return NextResponse.json(
              {
                error: 'Quiz vouchers are not approved for production use',
                code: error.code,
              },
              { status: error.status }
            );
          }

          throw error;
        }
      }

      for (const [index, item] of items.entries()) {
        if (!hasQuizVoucherIdentifier(item)) {
          continue;
        }

        if (item.quantity !== 1) {
          return invalidQuizVoucherQuantityResponse();
        }

        const voucherToken = getQuizVoucherToken(item);
        if (!voucherToken) {
          return invalidQuizVoucherTokenResponse();
        }

        const tokenVerification = verifyQuizVoucherToken(voucherToken);
        if (!tokenVerification.ok) {
          if (tokenVerification.error === 'missing_quiz_voucher_secret') {
            return NextResponse.json(
              {
                code: 'QUIZ_VOUCHER_TOKEN_CONFIG_MISSING',
                error: 'Quiz voucher verification is not configured',
              },
              { status: 500 }
            );
          }

          if (tokenVerification.error === 'expired_quiz_voucher_token') {
            return NextResponse.json(
              {
                code: 'QUIZ_VOUCHER_TOKEN_EXPIRED',
                error: 'Quiz voucher token has expired',
                // Identify the exact failed line so checkout prunes only it,
                // preserving other valid vouchers in a multi-prize cart.
                rejectedVoucherToken: voucherToken,
              },
              { status: 400 }
            );
          }

          return invalidQuizVoucherTokenResponse(voucherToken);
        }

        const itemProductId = getOrderItemProductId(item);
        const itemVariantId = getOrderItemVariantId(item);
        const itemCondition = getOrderItemCondition(item);
        if (
          tokenVerification.payload.userId !== resolvedUserId ||
          tokenVerification.payload.productId !== itemProductId ||
          tokenVerification.payload.variantId !== itemVariantId ||
          tokenVerification.payload.condition !== itemCondition
        ) {
          return invalidQuizVoucherTokenResponse(voucherToken);
        }

        verifiedQuizVoucherAwardIdsByIndex.set(
          index,
          tokenVerification.payload.awardId
        );
        if (
          !verifiedQuizVoucherTokenByAwardId.has(
            tokenVerification.payload.awardId
          )
        ) {
          verifiedQuizVoucherTokenByAwardId.set(
            tokenVerification.payload.awardId,
            voucherToken
          );
        }
      }

      const voucherAwardIds = [
        ...new Set(verifiedQuizVoucherAwardIdsByIndex.values()),
      ];
      const voucherLineCount = verifiedQuizVoucherAwardIdsByIndex.size;
      if (voucherAwardIds.length === 0) {
        return invalidQuizVoucherTokenResponse();
      }

      // Load EVERY distinct award before deciding on a multi-voucher conflict.
      // A token can carry a valid (unexpired) signature for an award that is
      // already claimed/void, so signature checks alone are not enough. Awards
      // are pruned line-by-line via `rejectedVoucherToken`; QUIZ_VOUCHER_MULTIPLE
      // is checkout's do-NOT-prune signal, so emitting it for an unredeemable
      // line would strand the shopper with a voucher they can never check out.
      const { data: voucherAwardRows, error: voucherAwardError } =
        await supabase
          .from('quiz_awards')
          .select(
            'id, status, award_type, customer_id, reserved_order_id, quiz_events!inner(regulatory_basis, regulatory_jurisdiction, regulatory_evidence_ref, compliance_verified)'
          )
          .in('id', voucherAwardIds);
      if (voucherAwardError) {
        logger.error({
          message: 'Quiz voucher award lookup failed',
          error: voucherAwardError,
          voucherAwardIds,
        });
        // A LOOKUP failure (transient DB/RLS/PostgREST) is NOT a bad voucher.
        // Returning the 400 QUIZ_VOUCHER_TOKEN_INVALID shape would make checkout
        // prune the only prize line and destroy a valid won prize. Return a
        // non-pruning 5xx so the shopper can retry with the voucher intact.
        return NextResponse.json(
          {
            code: 'QUIZ_VOUCHER_LOOKUP_FAILED',
            error:
              'Could not verify your quiz prize right now. Please try again.',
          },
          { status: 503 }
        );
      }

      const voucherAwardRowById = new Map(
        (voucherAwardRows ?? []).map((row) => [row.id, row] as const)
      );
      // A redeemable award is approved AND store-credit-typed — the same gate
      // create_storefront_order_with_quiz_voucher enforces in the DB. Anything
      // else (claimed, void, wrong type, or missing) is a bad line, not a
      // "too many prizes" conflict.
      const validVoucherAwardIds = voucherAwardIds.filter((awardId) => {
        const row = voucherAwardRowById.get(awardId);
        return row?.status === 'approved' && row.award_type === 'store_credit';
      });

      // Validate award status BEFORE reporting a multi-voucher conflict: prune
      // any genuinely-bad line first so a stale/claimed voucher never masquerades
      // as a redeem-one-at-a-time situation.
      if (validVoucherAwardIds.length !== voucherAwardIds.length) {
        // Idempotent retry: a single-voucher checkout that succeeded but lost or
        // timed out its HTTP response already moved the award approved→claimed
        // and created its (paid) prize order. Retrying then fails this
        // approved-only filter and checkout prunes the only prize line, so the
        // shopper never reaches the success screen for an order they already own.
        // The token was verified against this user (userId === resolvedUserId),
        // so a claimed store-credit award with a reserved order is that same
        // user's completed prize — return it as a replayed success instead.
        if (voucherAwardIds.length === 1) {
          const soleAwardId = voucherAwardIds[0];
          const soleRow = voucherAwardRowById.get(soleAwardId);
          if (
            soleRow?.status === 'claimed' &&
            soleRow.award_type === 'store_credit'
          ) {
            // Resolve the order the claim created. The serialized-prize path
            // stamps `reserved_order_id` on the award; the standard path instead
            // tags the created order_item with `quiz_award_id`. Try both so the
            // idempotent replay covers every prize type.
            let claimedOrderId = soleRow.reserved_order_id ?? null;
            if (!claimedOrderId) {
              const { data: claimedItem, error: claimedItemError } =
                await supabase
                  .from('order_items')
                  .select('order_id')
                  .eq('quiz_award_id', soleAwardId)
                  .maybeSingle();
              // A transient lookup failure must NOT fall through to the
              // invalid-token response — that tells checkout to prune the only
              // prize line for an award the shopper has already claimed. Surface
              // a non-pruning 503 so the retry can find the order once the blip
              // clears.
              if (claimedItemError) {
                logger.error({
                  message: 'Quiz voucher replay order_items lookup failed',
                  error: claimedItemError,
                  awardId: soleAwardId,
                });
                return NextResponse.json(
                  {
                    code: 'QUIZ_VOUCHER_LOOKUP_FAILED',
                    error:
                      'Could not verify your quiz prize right now. Please try again.',
                  },
                  { status: 503 }
                );
              }
              claimedOrderId = claimedItem?.order_id ?? null;
            }
            if (claimedOrderId) {
              const { data: claimedOrder, error: claimedOrderError } =
                await supabase
                  .from('orders')
                  .select(
                    'id, order_number, tracking_token, subtotal, shipping_fee, discount_amount, tax_amount, total, customer_id, customer_email, customer_name, customer_phone, payment_status, shipping_status, payment_method, shipping_address, merchant_id'
                  )
                  .eq('id', claimedOrderId)
                  .eq('customer_id', soleRow.customer_id)
                  .maybeSingle();
              // Same fail-closed rule: an errored order lookup is transient, not
              // proof the voucher is invalid — return 503, never prune.
              if (claimedOrderError) {
                logger.error({
                  message: 'Quiz voucher replay order lookup failed',
                  error: claimedOrderError,
                  orderId: claimedOrderId,
                  awardId: soleAwardId,
                });
                return NextResponse.json(
                  {
                    code: 'QUIZ_VOUCHER_LOOKUP_FAILED',
                    error:
                      'Could not verify your quiz prize right now. Please try again.',
                  },
                  { status: 503 }
                );
              }
              if (claimedOrder) {
                // The claim may have created the order but died before
                // `finalize_quiz_voucher_order_payment` marked it paid. NEVER
                // fabricate a paid status for a still-unpaid row — retry the
                // finalizer first, and if that fails surface a non-pruning error
                // so the shopper keeps the voucher and can retry.
                if (claimedOrder.payment_status !== 'paid') {
                  const { error: replayFinalizeError } = await supabase.rpc(
                    'finalize_quiz_voucher_order_payment',
                    {
                      p_award_id: soleAwardId,
                      p_order_id: claimedOrder.id,
                    }
                  );
                  if (replayFinalizeError) {
                    logger.error({
                      message: 'Quiz voucher replay finalize failed',
                      error: replayFinalizeError,
                      orderId: claimedOrder.id,
                      awardId: soleAwardId,
                    });
                    return NextResponse.json(
                      {
                        code: 'QUIZ_VOUCHER_LOOKUP_FAILED',
                        error:
                          'Could not verify your quiz prize right now. Please try again.',
                      },
                      { status: 503 }
                    );
                  }
                }
                return NextResponse.json(
                  {
                    order: {
                      ...claimedOrder,
                      payment_status: 'paid',
                      payment_method: 'quiz_voucher',
                    },
                    wallet: null,
                    savings: null,
                    amountDueToGateway: 0,
                    idempotency: { replayed: true },
                  },
                  {
                    status: 200,
                    headers: { 'x-idempotency-replayed': 'true' },
                  }
                );
              }
            }
          }
        }

        const rejectedAwardId = voucherAwardIds.find(
          (awardId) => !validVoucherAwardIds.includes(awardId)
        );
        return invalidQuizVoucherTokenResponse(
          rejectedAwardId
            ? verifiedQuizVoucherTokenByAwardId.get(rejectedAwardId)
            : undefined
        );
      }

      if (voucherLineCount > 1 || validVoucherAwardIds.length > 1) {
        // Every voucher line is individually valid — the shopper just won more
        // than one prize. Surface a distinct code so checkout tells them to
        // redeem one at a time instead of discarding both valid vouchers.
        return tooManyQuizVouchersResponse();
      }

      if (hasNonQuizVoucherItem(items)) {
        return NextResponse.json(
          {
            code: 'QUIZ_VOUCHER_MIXED_CART_UNSUPPORTED',
            error: 'Quiz prize vouchers must be checked out separately',
          },
          { status: 400 }
        );
      }

      const voucherEvent = getQuizVoucherAwardEvent(
        voucherAwardRowById.get(validVoucherAwardIds[0])
      );
      try {
        enforcePrizeProductionGuard(
          {
            regulatory_basis: voucherEvent?.regulatoryBasis,
            regulatory_evidence_ref: voucherEvent?.regulatoryEvidenceRef,
            regulatory_jurisdiction: voucherEvent?.regulatoryJurisdiction,
          },
          getQuizPhaseEnv() === 'production' &&
            getQuizProductionApprovedEnv() &&
            voucherEvent?.complianceVerified === true
        );
      } catch (error) {
        if (error instanceof QuizProductionNotApprovedError) {
          return NextResponse.json(
            {
              error: 'Quiz vouchers are not approved for production use',
              code: error.code,
            },
            { status: error.status }
          );
        }

        throw error;
      }
    }

    // Fetch merchant to verify it exists (include business_name, slug for email)
    const { data: merchant, error: merchantFetchError } = await supabase
      .from('merchants')
      .select(
        'id, phone, rider_phone_number, business_name, business_address, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number, plan_tier, vat_registration_status, vat_rate, registered_address, support_phone, logo_url, legal_entity_name, brand_colors, bank_code, bank_account_number, bank_name, bank_account_name, social_media, pages, payout_currency, country'
      )
      .eq('id', merchant_id)
      .single();

    if (merchantFetchError || !merchant) {
      logger.error({
        message: 'Failed to fetch merchant for order creation',
        error: merchantFetchError,
      });
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // Canonical merchant currency (payout_currency -> country -> NGN). The
    // order-create RPC stamps orders.currency the same way, so this is the
    // currency any FRESH order created below will carry.
    const merchantResolvedCurrency =
      resolveMerchantCurrencyConfig(merchant).code;

    const orderItemsPayload = items.map((item, index) => {
      const hasAssurance = item.has_assurance || false;
      const itemPrice = item.negotiatedPrice ?? item.price;
      const variantName = getOrderItemVariantLabel(item, {
        includeConditionFallback: false,
      });
      // SECURITY: Recompute assurance_fee server-side — never trust client values (quantity-aware)
      const assuranceFee = hasAssurance
        ? roundCurrency(itemPrice * item.quantity * SERVER_ASSURANCE_RATE)
        : 0;
      const voucherAwardId = verifiedQuizVoucherAwardIdsByIndex.get(index);

      return {
        product_id: getOrderItemProductId(item),
        condition: item.condition,
        image_url: item.imageUrl ?? item.image_url ?? null,
        variant_id: item.variantId || item.variant_id,
        variant_name: variantName ?? undefined,
        variant_attributes:
          item.variantAttributes || item.variant_attributes || {},
        quantity: item.quantity,
        price: itemPrice,
        has_assurance: hasAssurance,
        assurance_fee: assuranceFee,
        ...(voucherAwardId ? { voucher_award_id: voucherAwardId } : {}),
      };
    });

    if (orderItemsPayload.some((item) => !item.product_id)) {
      return NextResponse.json(
        { error: 'Invalid order items' },
        { status: 400 }
      );
    }

    let quizVoucherRouteProof: ReturnType<
      typeof createQuizRpcServerProof
    > | null = null;
    const quizVoucherAwardIdsForOrder = hasVoucherItem
      ? [...new Set(verifiedQuizVoucherAwardIdsByIndex.values())]
      : [];
    const quizVoucherAwardIdForOrder =
      quizVoucherAwardIdsForOrder.length === 1
        ? (quizVoucherAwardIdsForOrder[0] ?? null)
        : null;
    if (hasVoucherItem) {
      if (!resolvedUserId) {
        return NextResponse.json(
          {
            error: 'Authentication required for quiz voucher orders',
            code: 'QUIZ_VOUCHER_AUTH_REQUIRED',
          },
          { status: 401 }
        );
      }

      if (quizVoucherAwardIdsForOrder.length > 1) {
        return tooManyQuizVouchersResponse();
      }
      if (quizVoucherAwardIdsForOrder.length !== 1) {
        return invalidQuizVoucherTokenResponse();
      }
      if (!quizVoucherAwardIdForOrder) {
        return invalidQuizVoucherTokenResponse();
      }

      quizVoucherRouteProof = createQuizRpcServerProof({
        action: 'create_storefront_order_with_quiz_voucher',
        payload: {
          items: orderItemsPayload.map((item) => ({
            condition: item.condition ?? null,
            product_id: item.product_id,
            quantity: item.quantity,
            variant_id: item.variant_id ?? null,
            voucher_award_id: item.voucher_award_id ?? null,
          })),
          merchant_id,
          user_id: resolvedUserId,
        },
        subjectId: quizVoucherAwardIdForOrder,
        userId: resolvedUserId,
      });
    }

    const shippingFeeValue = Number.parseFloat(shipping_fee.toString());
    const discountAmountValue = Number.parseFloat(
      (body.discount_amount || 0).toString()
    );
    const taxAmountValue = Number.parseFloat((body.tax_amount || 0).toString());
    // B3.5 (Δ-39): gift_wrapping_fee + tax_basis are now first-class
    // RPC params. Zod defaults gift_wrapping_fee to 0 and tax_basis to
    // 'exclusive', so legacy callers continue to work; VAT-aware
    // storefront callers pass both explicitly.
    const giftWrappingFeeValue = Number.parseFloat(
      (body.gift_wrapping_fee || 0).toString()
    );

    if (
      Number.isNaN(shippingFeeValue) ||
      Number.isNaN(discountAmountValue) ||
      Number.isNaN(taxAmountValue) ||
      Number.isNaN(giftWrappingFeeValue)
    ) {
      return NextResponse.json(
        { error: 'Invalid pricing values' },
        { status: 400 }
      );
    }

    let localAirportShippingFee: number | null;
    let isIdempotentLocalAirportReplay: boolean;
    let isIdempotentOrderReplay = false;
    let canonicalDeliveryMethod = delivery_method;
    let canonicalAirportType = airport_type;
    try {
      const validationResult = await validateLocalAirportDeliveryFee({
        airportType: airport_type,
        deliveryMethod: delivery_method,
        merchantId: merchant_id,
        requestIdempotencyKey,
        selectedQuoteId: body.selected_quote_id,
        shippingAddress: shipping_address,
        shippingFee: shippingFeeValue,
        shippingProvider: body.shipping_provider,
        shippingRateId: body.shipping_rate_id,
        source,
        supabase,
      });
      ({
        isIdempotentLocalAirportReplay,
        isIdempotentOrderReplay = false,
        localAirportShippingFee,
      } = validationResult);
      canonicalDeliveryMethod =
        validationResult.resolvedDeliveryMethod ?? delivery_method;
      canonicalAirportType =
        validationResult.resolvedAirportType ?? airport_type;
    } catch (error) {
      if (
        error instanceof LocalAirportDeliveryFeeMismatchError ||
        error instanceof LocalAirportDeliveryValidationError
      ) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        );
      }
      throw error;
    }

    // A provider-backed airport quote is always airport delivery. Persist and
    // hash that durable discriminator even when older clients omitted the
    // redundant airport_type field, so equivalent retries cannot diverge on
    // omitted versus explicit metadata.
    if (canonicalDeliveryMethod === 'airport' && body.selected_quote_id) {
      canonicalAirportType = 'delivery';
    }

    if (discountAmountValue !== 0) {
      return NextResponse.json(
        {
          code: 'discount_amount_not_supported',
          error: 'Failed to create order',
        },
        { status: 400 }
      );
    }

    // Storefront discount code (only codes are trusted; raw discount_amount is
    // still rejected above). Detected early so the negotiation discount can be
    // suppressed when a code is applied (mutually exclusive — code wins).
    const requestedDiscountCode =
      typeof body.discount_code === 'string' &&
      body.discount_code.trim().length > 0
        ? body.discount_code.trim()
        : null;

    // Codex P1 (PR #1622 round 6): the legacy storefront checkout
    // (`apps/web/src/app/checkout/page.tsx`) doesn't send
    // `tax_amount` — Zod defaults to 0 — and that 0 tripped the
    // RPC's `tax_amount_mismatch` guard on every VAT-registered
    // merchant. Same root cause as the agentic dispatch.
    //
    // Recompute the canonical per-line tax server-side here so
    // every caller (legacy checkout, ogabassey checkout,
    // mobile-admin order-create, agentic) lands on a payload that
    // the RPC will accept. The `expected_total` parity guard
    // (Δ-39, Codex round 2) still catches client display drift —
    // it just gets to fire on a correctly-tax'd order rather than
    // being preceded by a confusing `tax_amount_mismatch` 400.
    //
    // The helper uses the caller's standard scoped client. The
    // single RLS-bypassing path (variant override lookup) goes
    // through the `get_order_variant_overrides` SECURITY DEFINER
    // RPC, granted to anon/authenticated/service_role — the trust
    // boundary lives in the database, not the Next.js layer
    // (CodeRabbit High on PR #1622 round 7).
    let serverComputedTaxAmount: number;
    try {
      serverComputedTaxAmount = await computeAgenticOrderTax({
        items: items.map((item) => ({
          product_id: item.product_id || item.productId || item.id,
          quantity: item.quantity,
          variant_id: item.variantId || item.variant_id,
        })),
        merchantId: merchant_id,
        supabase,
      });
    } catch (taxError) {
      // Codex P2 (PR #1622 round 7): malformed item ids (Zod only
      // validates as `string`) cascade into Postgres's UUID parser
      // as code 22P02. Pre-route-side-recompute, the RPC's own
      // 22P02 path got mapped via `clientErrorCodes` to a 400. We
      // must preserve that semantic so bad client payloads don't
      // look like server outages.
      if (isTaxComputeUuidError(taxError)) {
        logger.warn({
          error: taxError,
          merchantId: merchant_id,
          message: 'Storefront order received malformed item identifier',
        });
        // Match the RPC error mapping below (`{ error: 'Failed to
        // create order', details: <stable code> }`) AND share the
        // `invalid_items` identifier with the agentic dispatch's
        // 22P02 path — review findings on PR #1622 round 7.
        return NextResponse.json(
          {
            error: 'Failed to create order',
            details: 'invalid_items',
          },
          { status: 400 }
        );
      }
      logger.error({
        error: taxError,
        merchantId: merchant_id,
        message: 'Storefront order VAT recompute failed',
      });
      return NextResponse.json(
        { code: 'TAX_COMPUTE_FAILED', error: 'Unable to compute order tax' },
        { status: 500 }
      );
    }
    // Record the REAL recomputed VAT on every order, including quiz-voucher
    // prizes. For a VAT-registered merchant the voucher RPC delegates to
    // create_storefront_order, which recomputes VAT from the catalog price and
    // raises tax_amount_mismatch if we send 0 — so a taxable prize would never
    // redeem. The merchant absorbs the prize VAT: the order carries it (correct
    // for FIRS e-invoicing) and the voucher covers it (residual + gateway due
    // treat it as paid, below).
    const orderTaxAmount = serverComputedTaxAmount;

    const merchantCanAutoNegotiate = hasPriceNegotiationEntitlement(
      merchant.plan_tier,
      merchant.slug
    );
    const vatRegistered = merchant.vat_registration_status === 'registered';

    // ALWAYS validate per-line client prices — even for non-entitled merchants
    // and callers that omit expected_total. The RPC charges the catalog line
    // price, but it adds the route-recomputed `assurance_fee` (derived from the
    // client line price) into the subtotal, so an unvalidated below-catalog
    // price would leak an uncapped assurance discount. The derived discount is
    // only APPLIED below.
    let negotiationDiscount: Awaited<
      ReturnType<typeof computeOrderNegotiationDiscount>
    >;
    try {
      negotiationDiscount = await computeOrderNegotiationDiscount({
        items: orderItemsPayload,
        merchantId: merchant_id,
        supabase,
        vatRegistered,
      });
    } catch (negotiationDiscountError) {
      if (isCanonicalOrderSubtotalUuidError(negotiationDiscountError)) {
        logger.warn({
          error: negotiationDiscountError,
          merchantId: merchant_id,
          message:
            'Storefront order received malformed identifier during negotiation discount lookup',
        });
        return NextResponse.json(
          { error: 'Failed to create order', details: 'invalid_items' },
          { status: 400 }
        );
      }
      logger.error({
        error: negotiationDiscountError,
        merchantId: merchant_id,
        message: 'Storefront order negotiation discount recompute failed',
      });
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // Reject tampered lines before any side effects (non-negotiable below
    // catalog, or negotiable > 2% below catalog), regardless of entitlement /
    // expected_total.
    if (negotiationDiscount?.rejectionCode) {
      return NextResponse.json(
        {
          error: 'Failed to create order',
          details: negotiationDiscount.rejectionCode,
        },
        { status: 400 }
      );
    }

    // Apply the derived discount for entitled merchants when either:
    // - the caller supplied an expected_total for RPC parity, or
    // - the mobile storefront omitted expected_total until it can use the same
    //   per-line/catalog VAT source as this route. The per-line discount is
    //   still server-validated and capped before this point; this branch only
    //   decides whether the validated discount should be charged.
    const shouldApplyServerDerivedDiscount =
      merchantCanAutoNegotiate &&
      !requestedDiscountCode &&
      (typeof body.expected_total === 'number' || source === 'mobile_app');
    const serverDerivedDiscountAmount = shouldApplyServerDerivedDiscount
      ? (negotiationDiscount?.totalDiscount ?? 0)
      : 0;

    let transactionDiscountProofResult:
      | ReturnType<typeof createTransactionDiscountProof>
      | undefined;
    if (
      shouldApplyServerDerivedDiscount &&
      negotiationDiscount?.lineDiscounts
    ) {
      const transactionDiscountProofOutcome =
        createTransactionDiscountProofForCheckout({
          lineDiscounts: negotiationDiscount.lineDiscounts,
          merchantId: merchant_id,
          userId: resolvedUserId ?? 'guest',
        });
      if (!transactionDiscountProofOutcome.ok) {
        return transactionDiscountProofOutcome.response;
      }
      transactionDiscountProofResult = transactionDiscountProofOutcome.proof;
    }

    // Persist the server-derived line boundaries alongside the order. The
    // order RPC already stores ad-tracking JSON for guest checkouts, so this
    // avoids inferring VAT provenance from a mutable source/channel value while
    // keeping the transaction review read-only.
    const adTrackingPayload = buildTransactionDiscountAdTracking({
      adTracking: ad_tracking,
      clientIp,
      clientUserAgent,
      geoPrivacy,
      lineDiscounts: negotiationDiscount?.lineDiscounts,
      shouldApplyServerDerivedDiscount,
      transactionDiscountProof: transactionDiscountProofResult?.proof,
      transactionDiscountNonce: transactionDiscountProofResult?.nonce,
    });

    const {
      __baci_airport_type: _clientAirportType,
      __baci_delivery_method: _clientDeliveryMethod,
      ...adTrackingWithoutDeliveryMetadata
    } = (adTrackingPayload ?? {}) as Record<string, unknown>;
    const sanitizedAdTrackingPayload = adTrackingPayload
      ? adTrackingWithoutDeliveryMetadata
      : null;
    const orderAdTrackingPayload =
      canonicalDeliveryMethod || canonicalAirportType
        ? {
            ...(sanitizedAdTrackingPayload ?? {}),
            ...(canonicalDeliveryMethod
              ? { __baci_delivery_method: canonicalDeliveryMethod }
              : {}),
            ...(canonicalAirportType
              ? { __baci_airport_type: canonicalAirportType }
              : {}),
          }
        : sanitizedAdTrackingPayload;

    // Merchant-rate orders (shipping_rate_id present) take the existing
    // pickup/airport RPC bypass: shipping_provider null + selected_quote_id
    // null. Merchant rates are computed from config — never persisted in
    // shipping_quotes — so there is no quote row to validate or book, and a
    // provider string here would trip the RPC's shipping_quote_required
    // guard. Null both defensively even if a buggy client sent them
    // alongside shipping_rate_id.
    const isMerchantRateOrder = Boolean(body.shipping_rate_id);
    const resolvedShippingProvider = isMerchantRateOrder
      ? null
      : (body.shipping_provider ?? null);
    const resolvedSelectedQuoteId = isMerchantRateOrder
      ? null
      : (body.selected_quote_id ?? null);
    const resolvedTrackingNumber = body.tracking_number ?? null;
    let quoteValidationItems:
      | Awaited<ReturnType<typeof buildOrderQuoteValidationItems>>
      | undefined;
    if (resolvedSelectedQuoteId) {
      try {
        quoteValidationItems = await buildOrderQuoteValidationItems({
          items: orderItemsPayload,
          merchantId: body.merchant_id,
          supabase,
        });
      } catch (quoteValidationItemsError) {
        if (isCanonicalOrderSubtotalUuidError(quoteValidationItemsError)) {
          logger.warn({
            error: quoteValidationItemsError,
            merchantId: body.merchant_id,
            message:
              'Storefront order received malformed identifier during quote validation',
          });
          return NextResponse.json(
            { error: 'Failed to create order', details: 'invalid_items' },
            { status: 400 }
          );
        }
        logger.error({
          error: quoteValidationItemsError,
          merchantId: body.merchant_id,
          message: 'Storefront order quote validation item lookup failed',
        });
        return NextResponse.json(
          {
            code: 'QUOTE_VALIDATION_FAILED',
            error: 'Unable to validate quote',
          },
          { status: 500 }
        );
      }
    }
    let shippingAddressForOrder: OrderCreateInput['shipping_address'];
    try {
      shippingAddressForOrder = await enrichShippingAddressWithQuoteDestination(
        supabase,
        resolvedSelectedQuoteId,
        shipping_address,
        {
          items: quoteValidationItems,
          merchantId: body.merchant_id,
          shippingFee:
            isIdempotentLocalAirportReplay || isIdempotentOrderReplay
              ? undefined
              : shippingFeeValue,
          shippingProvider:
            isIdempotentLocalAirportReplay || isIdempotentOrderReplay
              ? null
              : resolvedShippingProvider,
        }
      );
    } catch (error) {
      if (error instanceof OrderQuoteDestinationMismatchError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        );
      }
      throw error;
    }
    // Capture the post-enrichment destination before Nigerian state repair so
    // the idempotency hash below stays byte-compatible with orders created
    // before this deploy (postal-code states like "100001"). Persistence and
    // merchant-rate zone verification still use the repaired address.
    const shippingAddressBeforeMerchantRateNormalization =
      shippingAddressForOrder;
    shippingAddressForOrder = normalizeMerchantRateOrderAddress(
      shippingAddressForOrder,
      isMerchantRateOrder
    );

    const payOnDelivery = isPayOnDelivery(payment_method);

    const voucherOrderAmountDueBeforeGateway = hasVoucherItem
      ? getVoucherOrderAmountDueBeforeGateway({
          discountAmount: serverDerivedDiscountAmount,
          giftWrappingFee: giftWrappingFeeValue,
          items: orderItemsPayload,
          // The prize's VAT and delivery are absorbed by the merchant and
          // covered by the voucher, so neither is a shopper residual — exclude
          // both here. Both are still recorded on the order (via orderTaxAmount
          // and p_shipping_fee) for the merchant's books and fulfilment.
          shippingFee: 0,
          taxAmount: 0,
        })
      : null;

    if (
      hasVoucherItem &&
      voucherOrderAmountDueBeforeGateway !== null &&
      voucherOrderAmountDueBeforeGateway > 0
    ) {
      return NextResponse.json(
        {
          code: 'QUIZ_VOUCHER_RESIDUAL_PAYMENT_UNSUPPORTED',
          error: 'Quiz prize vouchers cannot be combined with paid charges',
        },
        { status: 400 }
      );
    }

    const voucherOrderFullyCovered =
      hasVoucherItem &&
      voucherOrderAmountDueBeforeGateway !== null &&
      voucherOrderAmountDueBeforeGateway <= 0;

    let effectivePaymentMethod = payment_method;
    let effectivePaymentStatus = payment_status;
    if (voucherOrderFullyCovered) {
      effectivePaymentMethod = 'quiz_voucher';
      effectivePaymentStatus = 'unpaid';
    } else if (payOnDelivery) {
      effectivePaymentStatus = 'pending';

      if (merchant?.rider_phone_number) {
        logger.info({
          message: 'Rider Notification Triggered (POD)',
          riderPhone: merchant.rider_phone_number,
          customerName: customer_name,
          customerAddress: shippingAddressForOrder?.address,
        });
      } else {
        logger.warn({
          message: 'Rider Notification Skipped (No Phone Number)',
          merchantId: merchant_id,
        });
      }
    }

    // Hoisted above the idempotency hash so both the discount-code combination
    // guard and the hash can reference it.
    const savingsRedemptionRequested =
      use_savings_credit &&
      savings_goal_id &&
      typeof savings_amount === 'number' &&
      savings_amount > 0;
    // Customer savings are funded through NGN rails and carry no currency
    // column, so a ₦-denominated savings balance must never offset a non-NGN
    // order total at face value. Drop the redemption and fall back to the
    // plain (non-savings) order RPC instead of failing the checkout.
    const savingsCurrencySupported = merchantResolvedCurrency === 'NGN';
    if (savingsRedemptionRequested && !savingsCurrencySupported) {
      logger.warn({
        message: 'Savings redemption skipped: order currency is not NGN',
        merchantId: merchant_id,
        orderCurrency: merchantResolvedCurrency,
        savingsGoalId: savings_goal_id,
      });
    }
    const requestedSavingsRedemption =
      savingsRedemptionRequested && savingsCurrencySupported;

    // Canonical server-verified pre-discount subtotal. Computed lazily (at
    // most once) — shared by the discount-code amount computation and the
    // merchant shipping-rate fee verification below.
    let canonicalOrderSubtotal: number | null = null;

    // Resolve + validate the discount code server-side, then compute the amount
    // from the CANONICAL subtotal (never the client cart total). Eligibility /
    // targeting is enforced authoritatively + replay-safely in the wrapper RPC.
    let discountCodeId: string | null = null;
    let discountCodeAmount = 0;
    if (requestedDiscountCode) {
      if (hasVoucherItem) {
        return NextResponse.json(
          {
            code: 'DISCOUNT_CODE_VOUCHER_COMBINATION_UNSUPPORTED',
            error: 'Failed to create order',
          },
          { status: 400 }
        );
      }
      if (requestedSavingsRedemption) {
        return NextResponse.json(
          {
            code: 'DISCOUNT_CODE_SAVINGS_COMBINATION_UNSUPPORTED',
            error: 'Failed to create order',
          },
          { status: 400 }
        );
      }

      // include_inactive=true: resolve even a deactivated code so a retry can
      // reach the replay-aware wrapper; the wrapper decides replay vs a fresh
      // `code_inactive` rejection.
      const { data: discountRows, error: discountLookupError } =
        await supabase.rpc('get_storefront_discount_code', {
          p_merchant_id: merchant_id,
          p_code: requestedDiscountCode,
          p_include_inactive: true,
        });
      if (discountLookupError) {
        // Don't mask a server/DB failure as an invalid-code 400.
        logger.error({
          message: 'Discount code lookup failed',
          error: discountLookupError,
          merchantId: merchant_id,
        });
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
      const parsedDiscountArray = storefrontDiscountCodeRowSchema
        .array()
        .safeParse(discountRows);
      const parsedDiscountSingle = parsedDiscountArray.success
        ? null
        : storefrontDiscountCodeRowSchema.safeParse(discountRows);
      const discountRow = parsedDiscountArray.success
        ? (parsedDiscountArray.data[0] ?? null)
        : parsedDiscountSingle?.success
          ? parsedDiscountSingle.data
          : null;
      if (!discountRow) {
        return NextResponse.json(
          { code: 'discount_code_invalid', error: 'Invalid discount code' },
          { status: 400 }
        );
      }
      discountCodeId = discountRow.id;

      try {
        canonicalOrderSubtotal = await computeCanonicalOrderSubtotal({
          items: orderItemsPayload,
          merchantId: merchant_id,
          supabase,
        });
      } catch (subtotalError) {
        if (isCanonicalOrderSubtotalUuidError(subtotalError)) {
          return NextResponse.json(
            { error: 'Failed to create order', details: 'invalid_items' },
            { status: 400 }
          );
        }
        logger.error({
          error: subtotalError,
          merchantId: merchant_id,
          message: 'Discount canonical subtotal recompute failed',
        });
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
      if (canonicalOrderSubtotal == null) {
        return NextResponse.json(
          { error: 'Failed to create order', details: 'invalid_items' },
          { status: 400 }
        );
      }

      discountCodeAmount = computeDiscountAmountForSubtotal(
        {
          discount_type:
            discountRow.discount_type === 'fixed_amount'
              ? 'fixed'
              : 'percentage',
          discount_value: Number(discountRow.discount_value),
          maximum_discount_amount: discountRow.maximum_discount_amount,
        },
        canonicalOrderSubtotal
      );
    }

    // === MERCHANT SHIPPING RATE ENFORCEMENT (money path) ===
    // When checkout selected a merchant-configured rate (shipping_rate_id),
    // the fee is recomputed server-side from the merchant's zone/rate config,
    // the validated destination, and the canonical pre-discount subtotal. The
    // client's shipping_fee is only ACCEPTED when it matches the server value
    // (±0.01); a larger difference fails closed with 400
    // SHIPPING_FEE_MISMATCH — mirroring the RPC's order_total_mismatch
    // fail-closed stance — instead of silently overriding. The client
    // computed expected_total from ITS fee, so a silent server-side override
    // would only resurface downstream as a confusing order_total_mismatch;
    // rejecting here gives checkout a precise re-quote signal. The RPC then
    // receives the SERVER-computed amount (see effectiveShippingFee below).
    let verifiedMerchantShippingRate: {
      amount: number;
      rateName: string;
      currency: string;
      kind: MerchantRateKind;
      /**
       * Pickup collection snapshot for a `pickup` rate — persisted durably in
       * orders.shipping_pickup_details so the order retains the collection
       * point even if the rate is later edited/deleted. Undefined/null for
       * `ship` rates.
       */
      pickupAddress?: MerchantPickupAddress | null;
    } | null = null;
    // F1: an idempotent retry must replay the ORIGINAL order before it can be
    // re-judged against the merchant's CURRENT rate config. The shipping fee
    // was locked on the first order; if the merchant has since disabled,
    // deleted, or repriced the rate, re-running verifyOrderShippingRate here
    // would fail closed with a stale-rate 400 (SHIPPING_RATE_*) and break
    // checkout recovery. Detect an already-created order for this
    // (merchant + idempotency key) — matching the RPC's `WHERE merchant_id =
    // $1 AND checkout_idempotency_key = $2` lookup exactly (the header value is
    // trimmed in getRequestIdempotencyKey and the RPC trims again, so the keys
    // are byte-identical) — and skip verification so the RPC's replay path
    // returns the existing order. A genuine FIRST attempt (no existing order)
    // still runs the full fail-closed verification below. Service-role read:
    // guest checkouts cannot pass orders RLS, and the lookup is scoped to the
    // validated merchant id + the caller's own idempotency key.
    const isIdempotentMerchantRateReplay =
      body.shipping_rate_id && requestIdempotencyKey
        ? await hasExistingMerchantRateOrder({
            adminSupabase: createAdminClient(),
            merchantId: merchant_id,
            requestIdempotencyKey,
            shippingRateId: body.shipping_rate_id,
          })
        : false;
    if (body.shipping_rate_id && !isIdempotentMerchantRateReplay) {
      if (canonicalOrderSubtotal == null) {
        try {
          canonicalOrderSubtotal = await computeCanonicalOrderSubtotal({
            items: orderItemsPayload,
            merchantId: merchant_id,
            supabase,
          });
        } catch (subtotalError) {
          if (isCanonicalOrderSubtotalUuidError(subtotalError)) {
            return NextResponse.json(
              { error: 'Failed to create order', details: 'invalid_items' },
              { status: 400 }
            );
          }
          logger.error({
            error: subtotalError,
            merchantId: merchant_id,
            message: 'Shipping-rate canonical subtotal recompute failed',
          });
          return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        }
      }
      if (canonicalOrderSubtotal == null) {
        return NextResponse.json(
          { error: 'Failed to create order', details: 'invalid_items' },
          { status: 400 }
        );
      }

      // Service-role client: merchant_shipping_* tables have no anon grants
      // (the SECURITY DEFINER storefront RPC is the only read path) and this
      // endpoint serves unauthenticated guest checkouts. The id is
      // Zod-validated (uuid) and the read is scoped to merchant_id.
      let rateVerification: Awaited<ReturnType<typeof verifyOrderShippingRate>>;
      try {
        rateVerification = await verifyOrderShippingRate({
          supabase: createAdminClient(),
          merchantId: merchant_id,
          shippingRateId: body.shipping_rate_id,
          shippingAddress: {
            country:
              shippingAddressForOrder?.countryCode ||
              shippingAddressForOrder?.country ||
              null,
            state: shippingAddressForOrder?.state ?? null,
          },
          // Match the quote path's blank-country normalization EXACTLY: the
          // quote path resolves a blank `countryCode` back to NG, so a rate
          // shown at quote time must resolve the same domestic country at order
          // time. `?? 'NG'` only catches NULL/undefined, but the normalization
          // migration backfilled only NULL and free-text 'Nigeria' — NOT the
          // EMPTY STRING — so a merchant whose `merchants.country` is `''` (or
          // whitespace) would pass a blank country through and, paired with a
          // non-ISO `shipping_address.country`, fail `matchShippingZone` with
          // SHIPPING_RATE_ZONE_MISMATCH for a rate checkout just displayed.
          // Trim-then-default so empty/whitespace collapses to NG like NULL.
          merchantCountry: merchant.country?.trim() || 'NG',
          merchantCurrency: merchantResolvedCurrency,
          canonicalSubtotal: canonicalOrderSubtotal,
        });
      } catch (rateVerificationError) {
        // A LOAD failure (RPC / DB / schema-cache outage) is NOT a
        // customer-correctable invalid rate. Surface it as a 500 server error
        // rather than letting an empty rate payload masquerade as a genuine
        // SHIPPING_RATE_INVALID (which would falsely blame the shopper and mask
        // the outage). Genuine verification verdicts still return a typed
        // result and map to 400 below.
        if (rateVerificationError instanceof MerchantShippingRatesLoadError) {
          logger.error({
            message:
              'Storefront order shipping-rate verification could not load merchant rates',
            merchantId: merchant_id,
            shippingRateId: body.shipping_rate_id,
            error: rateVerificationError,
          });
          return NextResponse.json(
            {
              error: 'Unable to verify the selected shipping rate',
              code: 'SHIPPING_RATE_LOOKUP_FAILED',
            },
            { status: 500 }
          );
        }
        throw rateVerificationError;
      }

      if (!rateVerification.ok) {
        logger.warn({
          message:
            'Storefront order rejected: merchant shipping rate verification failed',
          code: rateVerification.code,
          merchantId: merchant_id,
          shippingRateId: body.shipping_rate_id,
        });
        return NextResponse.json(
          { error: rateVerification.message, code: rateVerification.code },
          { status: 400 }
        );
      }

      if (Math.abs(shippingFeeValue - rateVerification.amount) > 0.01) {
        // Tamper signal: the submitted fee is not what the merchant's rate
        // config produces for this destination + subtotal.
        logger.warn({
          message:
            'Storefront order rejected: shipping fee mismatch for merchant rate',
          merchantId: merchant_id,
          shippingRateId: body.shipping_rate_id,
          clientShippingFee: shippingFeeValue,
          serverShippingFee: rateVerification.amount,
        });
        return NextResponse.json(
          {
            error: 'Shipping fee does not match the selected shipping rate',
            code: 'SHIPPING_FEE_MISMATCH',
          },
          { status: 400 }
        );
      }

      verifiedMerchantShippingRate = {
        amount: rateVerification.amount,
        rateName: rateVerification.rateName,
        currency: rateVerification.currency,
        kind: rateVerification.kind,
        pickupAddress: rateVerification.pickupAddress,
      };

      // A merchant `ship` (door-delivery) rate is unfulfillable without a
      // delivery address. Verification can pass on the merchant-country zone
      // fallback for a country-level / rest-of-world zone even when the caller
      // omitted `shipping_address` entirely (a direct or buggy client), which
      // would persist a MERCHANT delivery order with no address. Require a
      // concrete destination — address + city + state, the same fields
      // fulfillment reads — before creating the order. `pickup` rates are
      // exempt: the shopper collects, so they rely on the rate's pickup
      // metadata rather than a shopper delivery address.
      if (verifiedMerchantShippingRate.kind === 'ship') {
        const hasDeliveryAddress = Boolean(
          shippingAddressForOrder?.address?.trim() &&
            shippingAddressForOrder?.city?.trim() &&
            shippingAddressForOrder?.state?.trim()
        );
        if (!hasDeliveryAddress) {
          logger.warn({
            message:
              'Storefront order rejected: merchant ship rate selected without a delivery address',
            merchantId: merchant_id,
            shippingRateId: body.shipping_rate_id,
          });
          return NextResponse.json(
            {
              error: 'A delivery address is required for this shipping rate',
              code: 'SHIPPING_ADDRESS_REQUIRED',
            },
            { status: 400 }
          );
        }
      }
    }

    // The SERVER-verified amount wins for merchant-rate orders (it differs
    // from the client value by ≤ 0.01 — anything larger was rejected above,
    // so the RPC's ±1 expected_total parity guard still passes). The existing
    // RPC signatures intentionally remain stable; delivery metadata is passed
    // through reserved ad-tracking keys and persisted/enforced by the orders
    // insert trigger, which strips those keys before storage.
    // idempotency hash below intentionally keeps the CLIENT value so retries
    // of the same request hash identically.
    const effectiveShippingFee =
      verifiedMerchantShippingRate?.amount ??
      (isIdempotentLocalAirportReplay ? null : localAirportShippingFee) ??
      shippingFeeValue;

    const { checkoutRequestHash, isLegacyIdempotencyReplay } =
      await prepareCheckoutIdempotencyReplay({
        canonicalAirportType,
        canonicalDeliveryMethod,
        merchantId: merchant_id,
        payload: requestIdempotencyKey
          ? {
              ...body,
              shipping_address: selectIdempotencyShippingAddress({
                addressBeforeMerchantRateNormalization:
                  shippingAddressBeforeMerchantRateNormalization,
                normalizedAddress: shippingAddressForOrder,
              }),
              // STABLE code identity, NOT the recomputed amount, so a merchant
              // editing the code between a checkout and its retry can't trip
              // checkout_idempotency_conflict before the wrapper's replay path.
              discount_amount: discountCodeId ? 0 : serverDerivedDiscountAmount,
              discount_code: requestedDiscountCode,
              delivery_method: canonicalDeliveryMethod,
              gift_wrapping_fee: giftWrappingFeeValue,
              airport_type: canonicalAirportType,
              items: orderItemsPayload,
              shipping_fee: shippingFeeValue,
              // Merchant-rate orders null shipping_provider + selected_quote_id, so
              // the rate id is the only field that distinguishes two same-priced
              // merchant rates (same fee + address) on an Idempotency-Key reuse.
              // Without it the RPC would replay the ORIGINAL order instead of
              // returning checkout_idempotency_conflict.
              shipping_rate_id: body.shipping_rate_id,
              tax_amount: orderTaxAmount,
            }
          : null,
        requestIdempotencyKey,
        supabase,
      });

    const savingsRedemptionIdempotencyKey = requestedSavingsRedemption
      ? getSavingsRedemptionIdempotencyKey({
          customerEmail: customer_email,
          items: orderItemsPayload.map((item) => ({
            product_id: item.product_id ?? '',
            quantity: item.quantity,
            variant_id: item.variant_id ?? null,
          })),
          merchantId: merchant_id,
          requestIdempotencyKey,
          savingsAmount: savings_amount,
          savingsGoalId: savings_goal_id,
        })
      : null;

    if (requestedSavingsRedemption && hasVoucherItem) {
      return NextResponse.json(
        {
          code: 'SAVINGS_VOUCHER_COMBINATION_UNSUPPORTED',
          error: 'Savings cannot be combined with quiz voucher orders',
        },
        { status: 400 }
      );
    }

    const orderItemsRpcPayload =
      addStorefrontOrderLineOrdinals(orderItemsPayload);

    const orderRpcArgs = {
      p_merchant_id: merchant_id,
      p_customer_email: customer_email,
      p_customer_name: customer_name,
      p_customer_phone: customer_phone || null,
      p_items: orderItemsRpcPayload,
      p_shipping_fee: effectiveShippingFee,
      p_discount_amount: discountCodeId
        ? discountCodeAmount
        : serverDerivedDiscountAmount,
      p_tax_amount: orderTaxAmount,
      p_payment_method: effectivePaymentMethod,
      p_payment_status: effectivePaymentStatus,
      p_shipping_status: shipping_status,
      p_shipping_address: shippingAddressForOrder || null,
      p_source: source,
      p_notes: notes || null,
      p_ad_tracking: orderAdTrackingPayload,
      p_selected_quote_id: resolvedSelectedQuoteId,
      p_shipping_provider: resolvedShippingProvider,
      p_tracking_number: resolvedTrackingNumber || null,
      p_user_id: resolvedUserId,
      // Server-computed tax — replaces the client-supplied value
      // so legacy callers without `tax_amount` succeed and
      // storefront callers can't fake a wrong-but-matching value
      // (Codex P1 round 6).
      // B3.5 (Δ-42, Δ-47): tax_basis + gift_wrapping_fee. The RPC
      // enforces VAT itself for VAT-registered merchants and also
      // runs a client/server total parity check (Codex P1) against
      // p_expected_total BEFORE any side effects, so a mismatch
      // rolls back atomically — no orphan order, no stock leak.
      //
      // Codex P1 round 6 (PR #1622): `tax_basis` is SERVER-controlled
      // policy, NOT caller input. The RPC itself overrides
      // `v_tax_basis := 'exclusive'` after enum validation
      // (`create_storefront_order` is GRANT'd to anon via PostgREST,
      // so the trust boundary has to live IN the function — see
      // the `Codex P1 round 6 ii` comment in
      // `20260512200000_storefront_order_vat_enforcement.sql`).
      // This API-level hardcode is defense-in-depth — any caller
      // routing through /api/orders also gets the right value
      // without relying on PostgREST RLS / RPC behavior.
      p_tax_basis: 'exclusive',
      p_gift_wrapping_fee: giftWrappingFeeValue,
      // Voucher orders: the shopper owes nothing, but the merchant absorbs the
      // recorded VAT + delivery, so the canonical order total must land at
      // exactly `tax + shipping + gift`. Passing that server-computed figure
      // (never the client's zero-priced-cart expected_total) arms the RPC's
      // parity gate: if the award + any negotiation discount don't fully cover
      // the CURRENT catalog price — e.g. the merchant raised the price during
      // the voucher window — `create_storefront_order` raises
      // `order_total_mismatch` and the whole wrapper tx rolls back BEFORE the
      // award is claimed, so the shopper keeps their prize instead of burning
      // it on a residual order. (Gift is always 0 here — a non-zero gift fee is
      // a shopper residual, rejected upstream as
      // QUIZ_VOUCHER_RESIDUAL_PAYMENT_UNSUPPORTED.)
      p_expected_total: hasVoucherItem
        ? orderTaxAmount + shippingFeeValue + giftWrappingFeeValue
        : typeof body.expected_total === 'number'
          ? body.expected_total
          : null,
      ...(quizVoucherRouteProof
        ? { p_route_proof: quizVoucherRouteProof }
        : {}),
      ...(requestIdempotencyKey && checkoutRequestHash
        ? {
            p_checkout_idempotency_key: requestIdempotencyKey,
            p_checkout_request_hash: checkoutRequestHash,
          }
        : {}),
    };

    const orderCreateRpcName = requestedSavingsRedemption
      ? 'create_storefront_order_with_savings'
      : hasVoucherItem
        ? 'create_storefront_order_with_quiz_voucher'
        : discountCodeId
          ? 'create_storefront_order_with_discount_code'
          : 'create_storefront_order';

    const orderCreateRpcArgs = requestedSavingsRedemption
      ? {
          ...orderRpcArgs,
          p_savings_amount: savings_amount,
          p_savings_goal_id: savings_goal_id,
          p_savings_idempotency_key: savingsRedemptionIdempotencyKey,
        }
      : discountCodeId
        ? { ...orderRpcArgs, p_discount_code_id: discountCodeId }
        : orderRpcArgs;

    const orderRpcClient = createStorefrontOrderRpcClient({
      fallbackClient: supabase,
      hasCanonicalDeliveryMetadata: Boolean(
        canonicalDeliveryMethod || canonicalAirportType
      ),
      merchantId: merchant_id,
      userId: resolvedUserId,
    });
    const { data: orderRows, error: orderError } = await orderRpcClient.rpc(
      orderCreateRpcName,
      orderCreateRpcArgs
    );

    const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;

    if (orderError || !order) {
      const code =
        typeof orderError?.code === 'string' ? orderError.code : null;
      const message =
        typeof orderError?.message === 'string'
          ? orderError.message
          : code || 'Failed to create order';
      const isAirportQuoteDatabaseRejection =
        code === '22023' &&
        (message === 'The selected airport delivery quote has expired' ||
          message === 'Selected airport delivery quote is invalid or expired');
      const airportQuoteErrorCode =
        message === 'The selected airport delivery quote has expired'
          ? 'AIRPORT_QUOTE_EXPIRED'
          : 'AIRPORT_QUOTE_INVALID';
      if (isAirportQuoteDatabaseRejection) {
        return NextResponse.json(
          {
            error: 'Failed to create order',
            details: message,
            code: airportQuoteErrorCode,
          },
          { status: 400 }
        );
      }
      if (
        requestedSavingsRedemption &&
        (message.includes('savings_') || code === '22023' || code === '42501')
      ) {
        return NextResponse.json(
          { code: code ?? 'SAVINGS_REDEMPTION_FAILED', error: message },
          {
            status:
              code === '22023' ||
              code === '42501' ||
              message.includes('not_authorized')
                ? 400
                : 409,
          }
        );
      }
      if (message === 'checkout_idempotency_conflict') {
        return NextResponse.json(
          {
            code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
            error:
              'This checkout request was already used for a different cart, customer, or delivery payload.',
          },
          { status: 409 }
        );
      }
      if (message === 'order_not_reusable') {
        return NextResponse.json(
          {
            code: 'CHECKOUT_ORDER_NOT_REUSABLE',
            error:
              'This checkout order can no longer be reused. Refresh checkout and start a new order.',
          },
          { status: 409 }
        );
      }
      // Discount-code limit outcomes are race/state conflicts, not malformed
      // input — surface as 409 so the client shows "no longer available".
      if (
        message === 'usage_limit_reached' ||
        message === 'per_customer_limit_reached'
      ) {
        return NextResponse.json(
          { code: message, error: 'Discount code is no longer available' },
          { status: 409 }
        );
      }
      const clientErrorCodes = [
        'invalid_items',
        'invalid_quantity',
        'invalid_variant',
        'insufficient_stock',
        'insufficient_variant_stock',
        'merchant_not_found',
        'customer_email_required',
        'customer_name_required',
        'items_required',
        'user_id_mismatch',
        'invalid_payment_status',
        'discount_amount_not_supported',
        // Discount-code redemption client errors (→ 400). The wrapper RPC
        // raises these for fresh orders; safe for the client to fix and retry.
        'discount_code_required',
        'discount_code_not_found',
        'discount_code_invalid',
        'discount_code_not_eligible',
        'code_inactive',
        'code_not_started',
        'code_expired',
        'minimum_purchase_not_met',
        'discount_amount_mismatch',
        // B3 (plan §5 B3): RPC raises when shipping_provider is set
        // without a quote id. Map to 4xx so the client gets the right
        // re-quote signal instead of a generic 500.
        'shipping_quote_required',
        // B3.5 (Δ-42, Δ-47): RPC raises when the client-supplied
        // VAT/total/gift-wrap inputs violate merchant VAT config.
        // All client-side input errors → 400 so the storefront can
        // re-quote / re-render the order summary cleanly instead of
        // bouncing the user with a generic 500.
        'invalid_tax_basis',
        'tax_amount_mismatch',
        'tax_amount_must_be_zero_for_non_vat_merchant',
        'quiz_voucher_invalid',
        'quiz_voucher_user_required',
        'quiz_voucher_award_not_found',
        'quiz_voucher_award_not_approved',
        'quiz_voucher_award_invalid_type',
        'quiz_voucher_order_item_not_found',
        'gift_wrapping_fee_negative',
        // B3.5 (Codex P1 — PR #1622): RPC RAISES this when the
        // client-supplied `p_expected_total` differs from the
        // server-computed total by > ₦1. The RAISE happens BEFORE
        // any side effects so the transaction rolls back cleanly
        // — safe for client to fix and retry.
        'order_total_mismatch',
        '22P02', // PostgreSQL: Invalid text representation (e.g. invalid UUID format)
      ];
      // create_storefront_order should return { message, code } for client errors.
      const isClientError =
        (code ? clientErrorCodes.includes(code) : false) ||
        clientErrorCodes.includes(message) ||
        isAirportQuoteDatabaseRejection;
      if (isClientError) {
        logger.warn({
          message: 'Storefront order rejected by client-side validation',
          error: orderError,
        });
      } else {
        logger.error({ message: 'Error creating order', error: orderError });
      }
      return NextResponse.json(
        {
          error: 'Failed to create order',
          details: message,
          ...(isAirportQuoteDatabaseRejection
            ? { code: airportQuoteErrorCode }
            : {}),
        },
        { status: isClientError ? 400 : 500 }
      );
    }

    // The order-create RPC's RETURNS TABLE carries no currency column, and an
    // idempotency replay can return an order that was stamped BEFORE a
    // payout-currency change — so read the stamped orders.currency back from
    // the row instead of re-deriving it from the CURRENT merchant record.
    // Service-role read: guest checkouts are not authorized by
    // orders_select_policy, and the replay case is exactly where the fallback
    // would be wrong, so the read-back must not silently miss for them. The
    // id is server-derived (returned by the SECURITY DEFINER create RPC), not
    // caller input. Fall back to the merchant-derived code (exactly what the
    // RPC stamps on a fresh order) only when the read errors.
    // Also read shipping_provider back: an idempotent merchant-rate REPLAY
    // whose first attempt failed the post-create stamp needs it to detect the
    // missing-metadata case and re-stamp (see the replay re-stamp block below).
    const { data: orderCurrencyRow, error: orderCurrencyError } =
      await createAdminClient()
        .from('orders')
        .select('currency, shipping_provider')
        .eq('id', order.id)
        .maybeSingle();
    if (orderCurrencyError) {
      logger.warn({
        message:
          'Order currency read-back failed; falling back to merchant-resolved currency',
        orderId: order.id,
        error: orderCurrencyError,
      });
    }
    const stampedOrderCurrency =
      typeof orderCurrencyRow?.currency === 'string'
        ? orderCurrencyRow.currency.trim().toUpperCase()
        : '';
    const orderCurrency = stampedOrderCurrency || merchantResolvedCurrency;

    const idempotencyReplayed =
      typeof order === 'object' &&
      order !== null &&
      'idempotency_replayed' in order &&
      order.idempotency_replayed === true;

    if (idempotencyReplayed && isLegacyIdempotencyReplay) {
      const replayMetadataResult = await persistReplayedDeliveryMetadata({
        airportType: canonicalAirportType,
        deliveryMethod: canonicalDeliveryMethod,
        orderId: order.id,
        rpcClient: orderRpcClient,
      });
      if (replayMetadataResult.error) {
        logger.error({
          message:
            'Failed to persist delivery metadata on legacy storefront order replay',
          error: replayMetadataResult.error,
          orderId: order.id,
          merchantId: merchant_id,
        });
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    }

    // Stamp the merchant-rate fulfillment provider post-create. Mirrors the
    // self-fulfill flow, which also writes orders.shipping_provider via an
    // UPDATE (the column is unconstrained free text); the create RPC has no
    // provider param on the pickup-bypass path this order used. A pickup rate
    // is stamped 'MERCHANT_PICKUP' and a shipped rate 'MERCHANT' so fulfillment
    // always sees the truth: the shopper chose pickup pricing, so the merchant
    // owes pickup — never a door delivery. Admin client: guest checkouts hold
    // no session that could pass orders RLS, and the id is server-derived from
    // the create RPC. Skipped on idempotent replay (the original request
    // already stamped). Failures are logged but never fail the order — it
    // exists and carries the verified fee either way.
    if (verifiedMerchantShippingRate && !idempotencyReplayed) {
      const merchantShippingProvider =
        verifiedMerchantShippingRate.kind === 'pickup'
          ? 'MERCHANT_PICKUP'
          : 'MERCHANT';
      // Pickup rates snapshot their collection address/instructions so the
      // customer + merchant order views retain the pickup point even after the
      // rate is later edited or deleted (mirrors the rate-name snapshot). Only
      // pickup orders carry it; ship rates leave the column untouched so their
      // stamp stays byte-identical.
      const pickupDetailsUpdate =
        verifiedMerchantShippingRate.kind === 'pickup'
          ? {
              shipping_pickup_details:
                verifiedMerchantShippingRate.pickupAddress ?? null,
            }
          : {};
      const { error: providerStampError } = await createAdminClient()
        .from('orders')
        .update({
          shipping_provider: merchantShippingProvider,
          // Persist WHICH merchant rate was bought so fulfillment can act on it.
          // The name is a durable snapshot (survives later edits/deletes of the
          // rate); the id is a soft link (nulled if the rate row is removed).
          shipping_rate_id: body.shipping_rate_id,
          shipping_rate_name: verifiedMerchantShippingRate.rateName,
          ...pickupDetailsUpdate,
        })
        .eq('id', order.id)
        .eq('merchant_id', merchant_id);
      if (providerStampError) {
        // The merchant can delete the selected rate between verification and
        // this stamp. `orders_shipping_rate_id_fkey` then rejects the now-
        // dangling shipping_rate_id (Postgres foreign_key_violation, 23503).
        // Because provider + id + name are one UPDATE, a rejection would leave
        // the order with NO provider AND NO rate-name snapshot — losing all
        // fulfillment info. Retry once, dropping the soft-link id, so the
        // durable provider + rate-name snapshot are ALWAYS persisted (the id is
        // recoverable-as-null; the name is not).
        if (providerStampError.code === '23503') {
          const { error: retryStampError } = await createAdminClient()
            .from('orders')
            .update({
              shipping_provider: merchantShippingProvider,
              shipping_rate_id: null,
              shipping_rate_name: verifiedMerchantShippingRate.rateName,
              // Keep the pickup snapshot on the retry — it is durable
              // fulfillment data, independent of the (now-nulled) rate id.
              ...pickupDetailsUpdate,
            })
            .eq('id', order.id)
            .eq('merchant_id', merchant_id);
          if (retryStampError) {
            logger.error({
              message:
                'Failed to stamp merchant-rate provider after dropping deleted rate id',
              error: retryStampError,
              orderId: order.id,
              merchantId: merchant_id,
              shippingProvider: merchantShippingProvider,
              shippingRateName: verifiedMerchantShippingRate.rateName,
            });
          } else {
            logger.warn({
              message:
                'Selected merchant rate was deleted mid-order; persisted provider + rate-name snapshot with a null shipping_rate_id',
              orderId: order.id,
              merchantId: merchant_id,
              shippingProvider: merchantShippingProvider,
              shippingRateName: verifiedMerchantShippingRate.rateName,
            });
          }
        } else {
          logger.error({
            message: 'Failed to stamp merchant-rate shipping provider on order',
            error: providerStampError,
            orderId: order.id,
            merchantId: merchant_id,
            shippingProvider: merchantShippingProvider,
            shippingRateName: verifiedMerchantShippingRate.rateName,
          });
        }
      }
    }

    // R9-5: re-stamp a merchant-rate REPLAY whose original stamp never landed.
    // If a FIRST merchant-rate attempt's create RPC succeeded but the
    // post-create provider UPDATE above failed, the order exists (keyed by the
    // idempotency key) yet carries no shipping_provider/shipping_rate_name. A
    // retry with the same Idempotency-Key takes the replay path, where
    // verifiedMerchantShippingRate is null so the create-path stamp is skipped
    // FOREVER — fulfillment would see an unconfigured merchant-rate order.
    // Detect the missing metadata on replay and best-effort backfill it.
    //
    // This must NEVER reject the replay: the whole point of the replay path is
    // to return the existing order even if the merchant has since changed or
    // deleted the rate. It only fills in absent fulfillment fields, logged.
    // When the metadata is already present it does nothing (and never reloads
    // the rate config). `body.shipping_rate_id` is narrowed to a string here.
    if (body.shipping_rate_id && idempotencyReplayed) {
      const existingShippingProvider = orderCurrencyRow?.shipping_provider;
      const merchantRateMetadataMissing =
        existingShippingProvider === null ||
        existingShippingProvider === undefined ||
        (typeof existingShippingProvider === 'string' &&
          existingShippingProvider.trim() === '');
      if (merchantRateMetadataMissing) {
        try {
          // Lighter than re-running verifyOrderShippingRate: a fail-soft load of
          // the merchant's active rates, then a lookup of the selected rate to
          // recover its name + kind. We are NOT re-charging (the fee is locked
          // on the existing order), so we deliberately skip zone/condition
          // re-verification — any recovered name/kind is enough to configure
          // fulfillment. A load failure or a since-removed rate simply leaves
          // the order as-is (logged), never failing the replay.
          const replayRatesPayload = await getMerchantShippingRates(
            createAdminClient(),
            merchant_id
          );
          const replayRate = replayRatesPayload.rates.find(
            (candidate) => candidate.id === body.shipping_rate_id
          );
          if (!replayRate) {
            logger.warn({
              message:
                'Merchant-rate replay is missing fulfillment metadata but the selected rate is no longer loadable; leaving the order unstamped',
              orderId: order.id,
              merchantId: merchant_id,
              shippingRateId: body.shipping_rate_id,
            });
          } else {
            const replayShippingProvider =
              replayRate.kind === 'pickup' ? 'MERCHANT_PICKUP' : 'MERCHANT';
            // Backfill the pickup snapshot too, so a pickup order whose first
            // stamp never landed still recovers its collection point on replay.
            const replayPickupDetailsUpdate =
              replayRate.kind === 'pickup'
                ? { shipping_pickup_details: replayRate.pickupAddress ?? null }
                : {};
            const { error: replayStampError } = await createAdminClient()
              .from('orders')
              .update({
                shipping_provider: replayShippingProvider,
                shipping_rate_id: body.shipping_rate_id,
                shipping_rate_name: replayRate.name,
                ...replayPickupDetailsUpdate,
              })
              .eq('id', order.id)
              .eq('merchant_id', merchant_id);
            if (replayStampError) {
              // Mirror the create-path 23503 retry: the rate can be deleted
              // between the load and this UPDATE, so drop the soft-link id and
              // keep the durable provider + rate-name snapshot.
              if (replayStampError.code === '23503') {
                const { error: replayRetryError } = await createAdminClient()
                  .from('orders')
                  .update({
                    shipping_provider: replayShippingProvider,
                    shipping_rate_id: null,
                    shipping_rate_name: replayRate.name,
                    ...replayPickupDetailsUpdate,
                  })
                  .eq('id', order.id)
                  .eq('merchant_id', merchant_id);
                if (replayRetryError) {
                  logger.error({
                    message:
                      'Failed to re-stamp merchant-rate replay after dropping the deleted rate id',
                    error: replayRetryError,
                    orderId: order.id,
                    merchantId: merchant_id,
                    shippingProvider: replayShippingProvider,
                    shippingRateName: replayRate.name,
                  });
                }
              } else {
                logger.error({
                  message:
                    'Failed to re-stamp merchant-rate fulfillment metadata on idempotent replay',
                  error: replayStampError,
                  orderId: order.id,
                  merchantId: merchant_id,
                  shippingProvider: replayShippingProvider,
                  shippingRateName: replayRate.name,
                });
              }
            }
          }
        } catch (replayStampException) {
          // Best-effort only: a re-stamp failure must never turn a successful
          // replay into an error response.
          logger.error({
            message:
              'Merchant-rate replay re-stamp raised unexpectedly; leaving the order metadata as-is',
            error: replayStampException,
            orderId: order.id,
            merchantId: merchant_id,
            shippingRateId: body.shipping_rate_id,
          });
        }
      }
    }

    // create_storefront_order* decremented product_variants/products stock inside
    // the RPC above (for every order — paid, POD, or unpaid). Bust the merchant's
    // storefront product caches so stock is fresh immediately instead of after the
    // ~300s 'products' cacheLife. One call covers the whole cart (the RPC processes
    // all p_items atomically — no per-line-item fan-out). Skip on idempotent replay
    // (no re-decrement). Fire here — before wallet/savings/email side effects — so
    // it is never gated on downstream success; guarded so it can't break checkout.
    if (!idempotencyReplayed) {
      try {
        await scheduleCheckoutProductBlogPurge({
          merchantId: merchant_id,
          merchantSlug: merchant.slug,
          orderId: order.id,
          orderItems: orderItemsPayload,
          supabase,
        });
      } catch (revalidateError) {
        logger.error({
          message: 'Failed to revalidate product caches after order creation',
          error: revalidateError,
          orderId: order.id,
          merchantId: merchant_id,
        });
      }
    }

    const orderTotal = Number(order.total ?? 0);
    const orderSubtotal = Number(order.subtotal ?? 0);
    const orderShippingFee = Number(order.shipping_fee ?? effectiveShippingFee);
    const customer_id = order.customer_id || null;
    const orderNum = order.order_number || order.id.slice(0, 8).toUpperCase();

    // === WALLET REDEMPTION (2025 Best Practice: Auto-apply at checkout) ===
    // Process wallet credit redemption atomically after order creation
    let walletRedemptionResult: {
      success: boolean;
      amountRedeemed: number;
      newBalance: number;
      transactionId: string | null;
    } | null = null;
    let savingsRedemptionResult: {
      success: boolean;
      amountRedeemed: number;
      goalId: string;
      redemptionId: string | null;
    } | null = null;

    if (requestedSavingsRedemption) {
      const savingsOrder = order as Record<string, unknown>;
      if (savingsOrder.savings_redemption_success === true) {
        savingsRedemptionResult = {
          success: true,
          amountRedeemed: Number(savingsOrder.savings_redeemed_amount),
          goalId: String(savingsOrder.savings_goal_id ?? savings_goal_id),
          redemptionId:
            typeof savingsOrder.savings_redemption_id === 'string'
              ? savingsOrder.savings_redemption_id
              : null,
        };
      } else {
        logger.error({
          message: 'Savings redemption failed after order RPC',
          orderId: order.id,
          orderNumber: order.order_number,
          customerId: customer_id,
          merchantId: merchant_id,
          savingsGoalId: savings_goal_id,
          requestedSavingsAmount: savings_amount,
          savingsRedemptionSuccess: savingsOrder.savings_redemption_success,
        });
        return NextResponse.json(
          {
            code: 'SAVINGS_REDEMPTION_FAILED',
            error: 'Savings redemption failed',
          },
          { status: 409 }
        );
      }
    }

    const savingsAmountUsed = savingsRedemptionResult?.amountRedeemed || 0;
    const remainingAfterSavings = Math.max(orderTotal - savingsAmountUsed, 0);

    // Customer wallets are an NGN-denominated ledger (customer_wallets has no
    // currency column), so redeeming against a non-NGN order would subtract
    // the naira balance at face value in the order currency. Wallet credit is
    // NGN-orders-only until the wallet gains a currency dimension.
    const walletCurrencySupported = orderCurrency === 'NGN';
    if (use_wallet_credit && wallet_amount > 0 && !walletCurrencySupported) {
      logger.warn({
        message: 'Wallet redemption skipped: order currency is not NGN',
        orderId: order.id,
        orderCurrency,
      });
    }

    if (
      use_wallet_credit &&
      walletCurrencySupported &&
      wallet_amount > 0 &&
      customer_id &&
      remainingAfterSavings > 0 &&
      // A quiz-voucher order is settled entirely by the voucher (with the
      // merchant absorbing the recorded VAT + delivery), so nothing is due —
      // `remainingAfterSavings` here is only that absorbed VAT/delivery, which
      // must never be charged to the shopper's wallet. Savings is already
      // rejected upstream (SAVINGS_VOUCHER_COMBINATION_UNSUPPORTED); skip wallet
      // redemption the same way so a shopper who also toggled wallet credit
      // isn't debited for costs the voucher path treats as covered.
      !hasVoucherItem
    ) {
      try {
        // Call atomic wallet redemption function (handles idempotency via order_id)
        const { data: redemptionData, error: redemptionError } =
          await supabase.rpc('redeem_wallet_for_order', {
            p_customer_id: customer_id,
            p_merchant_id: merchant_id,
            p_order_id: order.id,
            p_amount: Math.min(wallet_amount, remainingAfterSavings), // Can't redeem more than residual total
            p_order_reference: order.order_number || order.id,
          });

        if (redemptionError) {
          // Log but don't fail order - wallet redemption is optional
          logger.error({
            message: 'Wallet redemption failed',
            error: redemptionError,
            orderId: order.id,
            customerId: customer_id,
            requestedAmount: wallet_amount,
          });
        } else if (redemptionData?.[0]) {
          const result = redemptionData[0];
          if (result.success) {
            walletRedemptionResult = {
              success: true,
              amountRedeemed: Number(result.redeemed_amount),
              newBalance: Number(result.new_balance),
              transactionId: result.transaction_id,
            };

            logger.info({
              message: 'Wallet redemption successful',
              orderId: order.id,
              customerId: customer_id,
              amountRedeemed: result.redeemed_amount,
              newBalance: result.new_balance,
            });
          } else {
            logger.warn({
              message: 'Wallet redemption returned unsuccessful',
              orderId: order.id,
              customerId: customer_id,
              result,
            });
          }
        }
      } catch (walletError) {
        logger.error({
          message: 'Wallet redemption exception',
          error: walletError,
          orderId: order.id,
        });
      }
    }

    // Calculate amount due to payment gateway (total - wallet credit used)
    const walletAmountUsed = walletRedemptionResult?.amountRedeemed || 0;
    // A fully-covered quiz-voucher order is settled entirely by the voucher —
    // the merchant absorbs the recorded VAT, so nothing is due to the gateway
    // even though orderTotal now carries that VAT. Non-voucher orders keep the
    // standard residual math.
    const amountDueToGateway = voucherOrderFullyCovered
      ? 0
      : orderTotal - savingsAmountUsed - walletAmountUsed;
    let walletFinalized = false;
    let storeCreditFinalized = false;
    let quizVoucherFinalized = false;

    if (
      voucherOrderFullyCovered &&
      quizVoucherAwardIdForOrder &&
      amountDueToGateway <= 0 &&
      order.payment_status !== 'paid'
    ) {
      const { error: quizVoucherFinalizeError } = await supabase.rpc(
        'finalize_quiz_voucher_order_payment',
        {
          p_award_id: quizVoucherAwardIdForOrder,
          p_order_id: order.id,
        }
      );

      if (quizVoucherFinalizeError) {
        const message =
          typeof quizVoucherFinalizeError.message === 'string'
            ? quizVoucherFinalizeError.message
            : 'Quiz voucher payment finalization failed';
        logger.error({
          message: 'Failed to finalize quiz voucher payment',
          error: quizVoucherFinalizeError,
          orderId: order.id,
          quizVoucherAwardId: quizVoucherAwardIdForOrder,
        });
        return NextResponse.json(
          {
            code: 'QUIZ_VOUCHER_FINALIZE_FAILED',
            error: message,
            orderId: order.id,
          },
          { status: 409 }
        );
      }

      quizVoucherFinalized = true;
      logger.info({
        message: 'Order fully paid with quiz voucher',
        orderId: order.id,
        quizVoucherAwardId: quizVoucherAwardIdForOrder,
      });
    }

    // Persist the redemption onto the order row so payment webhooks can
    // validate residual gateway payouts against server-owned columns. Only
    // when a gateway payment actually follows — fully covered orders are
    // settled by the finalize RPCs below, and pre-writing amount_paid there
    // would make a failed finalization look like nothing is due.
    if (amountDueToGateway > 0) {
      await recordPreGatewayRedemption(
        order.id,
        orderTotal,
        savingsAmountUsed,
        walletAmountUsed
      );
    }

    // If wallet fully covers the order, mark as paid immediately (2025 best practice)
    if (
      savingsAmountUsed === 0 &&
      walletAmountUsed > 0 &&
      amountDueToGateway <= 0
    ) {
      const { error: walletFinalizeError } = await supabase.rpc(
        'finalize_wallet_order_payment',
        {
          p_order_id: order.id,
          p_amount: walletAmountUsed,
        }
      );

      if (walletFinalizeError) {
        logger.error({
          message: 'Failed to finalize wallet payment',
          error: walletFinalizeError,
          orderId: order.id,
        });
      } else {
        walletFinalized = true;
        logger.info({
          message: 'Order fully paid with wallet credit',
          orderId: order.id,
          walletAmountUsed,
        });
      }
    }

    if (savingsAmountUsed > 0 && amountDueToGateway <= 0) {
      const paymentMethod = walletAmountUsed > 0 ? 'store_credit' : 'savings';
      const { error: storeCreditFinalizeError } = await supabase.rpc(
        'finalize_store_credit_order_payment',
        {
          p_amount: savingsAmountUsed + walletAmountUsed,
          p_order_id: order.id,
          p_payment_method: paymentMethod,
        }
      );

      if (storeCreditFinalizeError) {
        const message =
          typeof storeCreditFinalizeError.message === 'string'
            ? storeCreditFinalizeError.message
            : 'Savings/store-credit payment finalization failed';
        logger.error({
          message: 'Failed to finalize savings/store-credit payment',
          error: storeCreditFinalizeError,
          orderId: order.id,
        });
        return NextResponse.json(
          {
            code: 'STORE_CREDIT_FINALIZE_FAILED',
            error: message,
            orderId: order.id,
          },
          { status: 409 }
        );
      }

      storeCreditFinalized = true;
      logger.info({
        message: 'Order fully paid with savings/store credit',
        orderId: order.id,
        savingsAmountUsed,
        walletAmountUsed,
      });
    }

    // NOTE: Order confirmation email is NOT sent here at order creation.
    // It is sent ONLY after payment is confirmed via webhook handlers:
    // - /api/payments/webhook/route.ts (for Paystack/Korapay)
    // - /api/payments/juicyway/webhook/route.ts (for Juicyway)
    // This prevents sending confirmation emails for abandoned/unpaid orders.
    //
    // Exceptions (send immediately, but fire-and-forget via after()):
    // - POD (Pay on Delivery) or Invoice: no payment gateway redirect
    // - Wallet-paid orders: payment already confirmed via wallet redemption
    //
    // after() runs after the response is sent — email/push never block the response.
    const isWalletFullyPaid = walletFinalized || storeCreditFinalized;
    const isQuizVoucherFullyPaid =
      voucherOrderFullyCovered &&
      amountDueToGateway <= 0 &&
      (quizVoucherFinalized || order.payment_status === 'paid');
    const shouldSendImmediateOrderNotifications =
      !idempotencyReplayed &&
      (isPayOnDelivery(effectivePaymentMethod) ||
        effectivePaymentMethod === 'invoice' ||
        isWalletFullyPaid ||
        isQuizVoucherFullyPaid);
    if (shouldSendImmediateOrderNotifications) {
      if (merchant.business_name && merchant.slug) {
        const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
        const merchantUrl = `https://${merchant.slug}.${rootDomain}`;

        const emailItems = items.map((item: EmailOrderItem) => ({
          name: getOrderItemDisplayName(item),
          quantity: item.quantity || 1,
          price: item.price || 0,
        }));

        const paymentLink = `${merchantUrl}/checkout/resume/${order.id}`;

        const emailData = {
          orderNumber: orderNum,
          customerName: customer_name,
          items: emailItems,
          subtotal: orderSubtotal,
          shippingFee: orderShippingFee,
          total: orderTotal,
          currency: orderCurrency,
          shippingAddress: {
            address: shippingAddressForOrder?.address || '',
            city: shippingAddressForOrder?.city || '',
            state: shippingAddressForOrder?.state || '',
            phone: customer_phone || '',
          },
          merchantName: merchant.business_name,
          merchantUrl,
          merchantTin: merchant.tax_identification_number ?? undefined,
          merchantRcNumber: merchant.cac_rc_number ?? undefined,
          paymentMethod: effectivePaymentMethod,
          paymentLink,
        };

        const htmlContent = generateOrderConfirmationEmail(emailData);
        const textContent = generateOrderConfirmationText(emailData);

        const replyToEmail =
          merchant.support_email ||
          merchant.email ||
          `support@${merchant.slug}.${rootDomain}`;
        const senderName = merchant.email_sender_name
          ? `${merchant.email_sender_name} Orders`
          : merchant.business_name
            ? `${merchant.business_name} Orders`
            : undefined;

        // Fire-and-forget: send email after response is delivered so slow/failing
        // ZeptoMail calls never block or time out the order creation response.
        after(async () => {
          try {
            let attachments:
              | Array<{ name: string; content: string; mime_type: string }>
              | undefined;
            let backgroundSupabase: ReturnType<
              typeof createAdminClient
            > | null = null;

            if (effectivePaymentMethod === 'invoice') {
              try {
                // Auto-generate Dedicated Virtual Account (DVA) for automatic confirmation
                const nameParts = (customer_name || 'Customer')
                  .trim()
                  .split(' ');
                const firstName = nameParts[0] || 'Customer';
                const lastName = nameParts.slice(1).join(' ') || 'User';
                let invoiceVirtualAccount: ReceiptOrder['virtual_account'] =
                  null;
                const invoiceTimingOrder = {
                  ...(order as Record<string, unknown>),
                  created_at:
                    typeof order.created_at === 'string'
                      ? order.created_at
                      : new Date().toISOString(),
                };
                // The customer can send display-only item names/prices, while
                // the storefront order RPC persists canonical product/variant
                // snapshots. Render invoice artifacts from those persisted
                // rows after the validated order exists.
                backgroundSupabase ??= createAdminClient();
                const persistedInvoiceItems =
                  await loadPersistedInvoiceOrderItems({
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

                const dvaResult = await generatePaymentAccount({
                  email: customer_email || `${order.id}@orders.usebaci.com`,
                  firstName,
                  lastName,
                  phone: customer_phone || merchant.phone || '08000000000',
                  orderId: order.id,
                });

                if (dvaResult.success) {
                  const generatedVirtualAccount = {
                    account_number: dvaResult.data.account_number,
                    bank_name: dvaResult.data.bank_name,
                    account_name: dvaResult.data.account_name,
                  };

                  // System-owned DVA/reminder records are written after the
                  // validated order exists; customers do not own these tables
                  // through RLS, so the server-only admin client is scoped to
                  // this post-response side effect and order.id.
                  backgroundSupabase ??= createAdminClient();
                  const persistenceFailure = await persistPaystackDvaAssignment(
                    backgroundSupabase,
                    {
                      accountName: dvaResult.data.account_name,
                      accountNumber: dvaResult.data.account_number,
                      bankName: dvaResult.data.bank_name,
                      customerEmail:
                        customer_email || `${order.id}@orders.usebaci.com`,
                      expiresAt:
                        getImmediateInvoiceDueDate(
                          invoiceTimingOrder
                        ).toISOString(),
                      orderId: order.id,
                    }
                  );

                  if (persistenceFailure) {
                    logger.error({
                      message: 'Failed to store auto-generated invoice DVA',
                      orderId: order.id,
                    });
                  } else {
                    invoiceVirtualAccount = generatedVirtualAccount;
                    logger.info({
                      message: 'Stored auto-generated invoice DVA successfully',
                      orderId: order.id,
                      accountNumber: dvaResult.data.account_number,
                    });
                  }
                } else {
                  logger.error({
                    message: 'Auto-generation of invoice DVA failed',
                    orderId: order.id,
                    error: dvaResult.error,
                  });
                }

                const fulfillment = getOrderFulfillmentDetails(
                  order as Record<string, unknown>
                );
                const hasDeviceItem = invoiceItems.some((item) =>
                  isDeviceReceiptItemName(getOrderItemBaseName(item))
                );
                const amountPaid = Math.max(
                  Number(order.amount_paid || 0),
                  savingsAmountUsed + walletAmountUsed
                );
                const invoiceOrder = {
                  ...invoiceTimingOrder,
                  amount_paid: amountPaid,
                  // The RPC return row carries no currency; without this the
                  // Peppol XML falls back to NGN while the PDF/email use the
                  // stamped order currency.
                  currency: orderCurrency,
                };
                const receiptOrder: ReceiptOrder = {
                  order_number: orderNum,
                  created_at: String(
                    order.created_at || new Date().toISOString()
                  ),
                  currency: orderCurrency,
                  total: orderTotal,
                  subtotal: orderSubtotal,
                  shipping_fee: orderShippingFee,
                  tax_amount: Number(order.tax_amount || 0),
                  discount_amount: Number(order.discount_amount || 0),
                  amount_paid: amountPaid,
                  balance: Math.max(orderTotal - amountPaid, 0),
                  payment_status: order.payment_status || payment_status,
                  payment_method: effectivePaymentMethod,
                  is_credit_order: Boolean(
                    (order as Record<string, unknown>).is_credit_order
                  ),
                  customer_name,
                  customer_email,
                  customer_phone: customer_phone || null,
                  shipping_address: buildImmediateInvoiceShippingAddress(
                    shippingAddressForOrder
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
                const receiptMerchant = buildImmediateInvoiceMerchant(merchant);
                const peppolInvoiceData = buildImmediatePeppolInvoiceData({
                  customerEmail: customer_email,
                  customerName: customer_name,
                  customerPhone: customer_phone,
                  fulfillment,
                  items: invoiceItems,
                  merchant,
                  notes,
                  order: invoiceOrder,
                  orderNumber: orderNum,
                  orderShippingFee,
                  orderSubtotal,
                  orderTotal,
                  paymentAccount: invoiceVirtualAccount,
                  shippingAddress: shippingAddressForOrder,
                });
                let peppolInvoiceXml: string | null = null;

                try {
                  peppolInvoiceXml =
                    generatePeppolInvoiceXml(peppolInvoiceData);
                } catch (peppolError) {
                  logger.error({
                    message: 'Failed to generate Peppol UBL invoice XML',
                    orderId: order.id,
                    orderNumber: orderNum,
                    error: peppolError,
                  });
                }

                let logoDataUri: string | null = null;
                try {
                  logoDataUri =
                    await resolveReceiptLogoDataUri(receiptMerchant);
                } catch (logoError) {
                  logger.warn({
                    message:
                      'Failed to resolve invoice logo; using fallback PDF branding',
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
                const pdfBlob = generateReceiptBlob(
                  invoiceReceiptOrder,
                  receiptMerchant,
                  {
                    buyerReference: peppolInvoiceData.buyer_reference,
                    complianceNote: peppolInvoiceXml
                      ? PEPPOL_BIS_BILLING_COMPLIANCE_NOTE
                      : undefined,
                    documentDate: peppolInvoiceData.issue_date,
                    documentKind: 'invoice',
                    dueDate: peppolInvoiceData.due_date,
                    firsCsid: peppolInvoiceData.firs_csid,
                    firsIrn: peppolInvoiceData.firs_irn,
                    invoiceTypeCode: peppolInvoiceData.invoice_type_code,
                    invoiceNotes: peppolInvoiceData.notes,
                    logoDataUri,
                    paymentTerms: peppolInvoiceData.payment_terms,
                    taxSubtotals: peppolInvoiceData.tax_subtotals,
                  }
                );
                const arrayBuffer = await pdfBlob.arrayBuffer();
                const base64Content =
                  Buffer.from(arrayBuffer).toString('base64');

                attachments = [
                  {
                    name: `invoice-${orderNum}.pdf`,
                    content: base64Content,
                    mime_type: 'application/pdf',
                  },
                ];

                if (peppolInvoiceXml) {
                  attachments.push({
                    name: `invoice-${orderNum}.xml`,
                    content: Buffer.from(peppolInvoiceXml, 'utf8').toString(
                      'base64'
                    ),
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
                    payment_link: paymentLink,
                  });

                if (reminderInsertError) {
                  logger.error({
                    message: 'Failed to store initial invoice reminder',
                    orderId: order.id,
                    paymentLink,
                    error: reminderInsertError,
                  });
                } else {
                  logger.info({
                    message: 'Stored initial invoice reminder successfully',
                    orderId: order.id,
                    paymentLink,
                  });
                }

                logger.info({
                  message:
                    'Generated branded invoice PDF and logged initial reminder',
                  orderId: order.id,
                  orderNumber: orderNum,
                });
              } catch (err) {
                logger.error({
                  message:
                    'Failed to generate invoice PDF or log initial reminder',
                  orderId: order.id,
                  error: err,
                });
              }
            }

            const emailResult = await sendEmail({
              to: customer_email,
              toName: customer_name,
              subject:
                effectivePaymentMethod === 'invoice'
                  ? `Invoice Generated - #${emailData.orderNumber}`
                  : `Order Confirmation - #${emailData.orderNumber}`,
              htmlContent,
              textContent,
              replyTo: replyToEmail,
              emailType: 'orders',
              fromName: senderName,
              attachments,
              auditContext: {
                merchantId: merchant_id,
                orderId: order.id,
                customerId: customer_id,
                metadata: {
                  trigger: 'order_create_immediate_confirmation',
                  paymentMethod: effectivePaymentMethod,
                },
              },
            });

            if (!emailResult.success) {
              logger.error({
                message: 'Failed to send order confirmation email',
                orderId: order.id,
                paymentMethod: effectivePaymentMethod,
                emailError: emailResult.error,
                emailErrorCode: emailResult.errorCode,
                emailErrorDetails: emailResult.errorDetails,
              });
            } else {
              logger.info({
                message: 'Order confirmation email sent',
                orderId: order.id,
                paymentMethod: effectivePaymentMethod,
                messageId: emailResult.messageId,
              });
            }
          } catch (emailError) {
            logger.error({
              message: 'Error sending order confirmation email',
              error: emailError,
            });
          }
        });
      }

      // Notify merchant of a new order or invoice — fire-and-forget via after().
      after(() =>
        dispatchOrderCreationNotifications({
          merchantId: merchant_id,
          orderId: order.id,
          orderNumber: orderNum,
          customerName: customer_name,
          orderTotal,
          orderCurrency,
          paymentMethod: effectivePaymentMethod,
          paymentStatus: order.payment_status,
          invoiceBalanceDue: Math.max(amountDueToGateway, 0),
          isWalletFullyPaid,
          preferenceClient: supabase,
        })
      );
    }

    // The create RPC's RETURNS TABLE carries no currency column, so surface
    // the stamped order currency explicitly — payment initialization must use
    // the ORDER's currency (a reused order keeps its original stamp even if
    // the merchant's payout currency later changes).
    const responseOrder = isWalletFullyPaid
      ? {
          ...order,
          currency: orderCurrency,
          payment_status: 'paid',
          payment_method: storeCreditFinalized
            ? walletAmountUsed > 0
              ? 'store_credit'
              : 'savings'
            : 'wallet',
        }
      : isQuizVoucherFullyPaid
        ? {
            ...order,
            currency: orderCurrency,
            payment_status: 'paid',
            payment_method: 'quiz_voucher',
          }
        : { ...order, currency: orderCurrency };

    await recordPlatformOrderCreatedEvent({
      currency: orderCurrency,
      customerEmail: customer_email,
      eventTimestamp:
        typeof order.created_at === 'string'
          ? order.created_at
          : new Date().toISOString(),
      ipAddress: clientIp,
      merchantId: merchant_id,
      orderId: order.id,
      orderNumber: orderNum,
      userAgent: clientUserAgent,
      value: orderTotal,
    });

    const responseBody = {
      order: responseOrder,
      // Wallet redemption details for UI display
      wallet: walletRedemptionResult
        ? {
            amountUsed: walletRedemptionResult.amountRedeemed,
            newBalance: walletRedemptionResult.newBalance,
            transactionId: walletRedemptionResult.transactionId,
          }
        : null,
      savings: savingsRedemptionResult
        ? {
            amountUsed: savingsRedemptionResult.amountRedeemed,
            goalId: savingsRedemptionResult.goalId,
            redemptionId: savingsRedemptionResult.redemptionId,
          }
        : null,
      // Amount still due to payment gateway (for payment initialization)
      amountDueToGateway: Math.max(amountDueToGateway, 0),
      ...(idempotencyReplayed ? { idempotency: { replayed: true } } : {}),
    };

    // Return order with wallet info for checkout UI
    return NextResponse.json(responseBody, {
      headers: idempotencyReplayed
        ? { 'x-idempotency-replayed': 'true' }
        : undefined,
      status: idempotencyReplayed ? 200 : 201,
    });
  } catch (error) {
    logger.error({ message: 'Unexpected error in POST /api/orders', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
