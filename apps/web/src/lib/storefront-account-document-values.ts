import {
  formatCanonicalProductConditionLabel,
  normalizeReceiptFulfillmentDetails,
} from '@baci/shared';
import type { CustomerInfo } from '@/lib/invoice-generator';
import type { StorefrontAccountDocumentItemRow } from '@/lib/storefront-account-document-bundle.types';
import type { StorefrontOrderItem } from '@/types/storefront-order';

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function asNumber(value: unknown): number {
  return typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value) || 0
      : 0;
}

export function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function normalizeShippingAddress(value: unknown) {
  if (typeof value === 'string') {
    return value ? { address_line1: value } : null;
  }

  const record = asRecord(value);
  if (!record) return null;

  return {
    address_line1: asString(
      record.address_line1 || record.address || record.street
    ),
    address_line2: asString(record.address_line2),
    city: asString(record.city),
    state: asString(record.state),
    postal_code: asString(record.postal_code),
    country: asString(record.country),
  };
}

export function buildCustomerAddress(
  shippingAddress: ReturnType<typeof normalizeShippingAddress>
): CustomerInfo['address'] {
  if (!shippingAddress) return undefined;

  return {
    street: [shippingAddress.address_line1, shippingAddress.address_line2]
      .filter(Boolean)
      .join(', '),
    city: shippingAddress.city || undefined,
    state: shippingAddress.state || undefined,
    postal_code: shippingAddress.postal_code || undefined,
    country: shippingAddress.country || undefined,
  };
}

function normalizeReceiptVariantDescriptor(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeReceiptVariantDescriptor(value: string | null | undefined) {
  const normalizedValue = normalizeReceiptVariantDescriptor(value || '');
  return normalizedValue ? normalizedValue.split(' ') : [];
}

function includesReceiptVariantDescriptor(
  value: string | null | undefined,
  descriptor: string
) {
  const valueTokens = tokenizeReceiptVariantDescriptor(value);
  const descriptorTokens = tokenizeReceiptVariantDescriptor(descriptor);

  if (!valueTokens.length || !descriptorTokens.length) {
    return false;
  }

  for (
    let index = 0;
    index <= valueTokens.length - descriptorTokens.length;
    index += 1
  ) {
    if (
      descriptorTokens.every(
        (token, tokenIndex) => valueTokens[index + tokenIndex] === token
      )
    ) {
      return true;
    }
  }

  return false;
}

function isBracketedConditionSegment(segment: string, conditionLabel: string) {
  const normalizedSegment = normalizeReceiptVariantDescriptor(segment);
  const normalizedCondition = normalizeReceiptVariantDescriptor(conditionLabel);

  if (!normalizedSegment || !normalizedCondition) {
    return false;
  }

  if (normalizedSegment === normalizedCondition) {
    return true;
  }

  if (normalizedCondition === 'used') {
    return (
      normalizedSegment === 'premium used' || normalizedSegment === 'uk used'
    );
  }

  if (normalizedCondition === 'new') {
    return normalizedSegment === 'brand new';
  }

  return false;
}

function getBracketedReceiptNameSegments(value: string | null | undefined) {
  const segments: string[] = [];
  const source = value || '';
  let segmentStart = -1;
  let closingBracket: ')' | ']' | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (!closingBracket && (character === '(' || character === '[')) {
      segmentStart = index + 1;
      closingBracket = character === '(' ? ')' : ']';
      continue;
    }

    if (closingBracket && character === closingBracket) {
      if (segmentStart >= 0 && segmentStart < index) {
        segments.push(source.slice(segmentStart, index));
      }

      segmentStart = -1;
      closingBracket = null;
    }
  }

  return segments;
}

function itemNameHasBracketedConditionLabel(
  value: string | null | undefined,
  conditionLabel: string
) {
  for (const segment of getBracketedReceiptNameSegments(value)) {
    if (isBracketedConditionSegment(segment, conditionLabel)) {
      return true;
    }
  }

  return false;
}

function buildReceiptVariantName(item: StorefrontAccountDocumentItemRow) {
  const variantName = item.variant_name?.trim();
  const conditionLabel = formatCanonicalProductConditionLabel(item.condition);

  if (!conditionLabel) {
    return variantName || undefined;
  }

  if (
    itemNameHasBracketedConditionLabel(item.name, conditionLabel) ||
    includesReceiptVariantDescriptor(variantName, conditionLabel)
  ) {
    return variantName || undefined;
  }

  return variantName ? `${variantName}, ${conditionLabel}` : conditionLabel;
}

export function buildOrderItems(
  itemRows: StorefrontAccountDocumentItemRow[]
): StorefrontOrderItem[] {
  return itemRows.map((item) => {
    if (item.quantity == null || !Number.isFinite(item.quantity)) {
      throw new Error(`Invalid order item quantity for item ${item.id}`);
    }

    const price =
      typeof item.price === 'number'
        ? item.price
        : typeof item.price === 'string' && item.price.trim()
          ? Number(item.price)
          : Number.NaN;

    if (!Number.isFinite(price)) {
      throw new Error(`Invalid order item price for item ${item.id}`);
    }

    const fulfillmentDetails =
      normalizeReceiptFulfillmentDetails(item.fulfillment_details) ??
      normalizeReceiptFulfillmentDetails(item.fulfillment_data);

    return {
      id: item.id,
      // Stored line IDs survive deletes (nonsequential): carry the real
      // value so fulfillment metadata keyed by line_id matches the right
      // product instead of the positional index.
      line_id: item.line_id ?? undefined,
      product_id: item.product_id || '',
      condition: item.condition || undefined,
      variant_id: item.variant_id || undefined,
      variant_name: buildReceiptVariantName(item),
      name: item.name,
      product_name: item.name,
      quantity: item.quantity,
      price,
      line_extension_amount:
        item.line_extension_amount == null
          ? undefined
          : asNumber(item.line_extension_amount),
      unit_code: item.unit_code || undefined,
      vat_category_code: item.vat_category_code || undefined,
      vat_rate: item.vat_rate == null ? undefined : asNumber(item.vat_rate),
      vat_amount:
        item.vat_amount == null ? undefined : asNumber(item.vat_amount),
      sellers_item_id: item.sellers_item_id || undefined,
      ...(fulfillmentDetails
        ? { fulfillment_details: fulfillmentDetails }
        : {}),
    };
  });
}

export function resolveMoneyValue(
  value: number | string | null | undefined,
  fallback: number
) {
  return value == null ? fallback : asNumber(value);
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
