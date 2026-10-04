import {
  formatCanonicalProductConditionLabel,
  formatOrderItemDisplayName,
  normalizeReceiptFulfillmentDetails,
  type ReceiptFulfillmentDetails,
  type ReceiptOrder,
} from '@baci/shared';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { formatVariantAttributesLabel } from '@/lib/format-variant-attributes-label';
import type { OrderCreateInput } from '@/schemas/orders';

export type OrderCreateItem = OrderCreateInput['items'][number];

export const SERVER_ASSURANCE_RATE = DEFAULT_ASSURANCE_RATE;
const IMMEDIATE_INVOICE_DUE_DAYS = 14;

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
