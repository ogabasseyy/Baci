import type { RichPaidOrder } from '@/lib/payments/paid-order-side-effect-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Paid order is missing ${key}`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const STRICT_NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;

function parseStrictNumber(rawValue: unknown, key: string) {
  if (typeof rawValue === 'number') {
    if (Number.isFinite(rawValue)) {
      return rawValue;
    }
    throw new Error(`Paid order has invalid ${key}`);
  }
  if (typeof rawValue === 'string' && STRICT_NUMERIC_STRING.test(rawValue)) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Paid order has invalid ${key}`);
}

function requiredNumber(record: Record<string, unknown>, key: string) {
  return parseStrictNumber(record[key], key);
}

function numberOrDefault(
  record: Record<string, unknown>,
  key: string,
  defaultValue: number
) {
  const value = record[key];
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return defaultValue;
  }
  return parseStrictNumber(value, key);
}

function optionalNumber(record: Record<string, unknown>, key: string) {
  const rawValue = record[key];
  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  ) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function optionalMoney(record: Record<string, unknown>, key: string) {
  const rawValue = record[key];
  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  ) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

export function toRichPaidOrderItems(
  value: unknown
): RichPaidOrder['order_items'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!isRecord(item)) {
      return {
        condition: null,
        id: null,
        name: null,
        price: null,
        product_id: null,
        quantity: null,
        variant_name: null,
      };
    }
    return {
      condition: optionalString(item, 'condition'),
      id: optionalString(item, 'id'),
      name: optionalString(item, 'name'),
      price: optionalMoney(item, 'price'),
      product_id: optionalString(item, 'product_id'),
      quantity: optionalNumber(item, 'quantity'),
      variant_name: optionalString(item, 'variant_name'),
    };
  });
}

export function toRichPaidOrder(
  order: unknown,
  context: { merchantId: string }
): RichPaidOrder {
  if (!isRecord(order)) {
    throw new Error('Paid order payload is invalid');
  }
  const shippingAddress = isRecord(order.shipping_address)
    ? {
        address: optionalString(order.shipping_address, 'address'),
        city: optionalString(order.shipping_address, 'city'),
        state: optionalString(order.shipping_address, 'state'),
      }
    : null;

  return {
    ad_tracking: isRecord(order.ad_tracking) ? order.ad_tracking : null,
    currency: optionalString(order, 'currency'),
    customer_email: optionalString(order, 'customer_email'),
    customer_id: optionalString(order, 'customer_id'),
    customer_name: optionalString(order, 'customer_name'),
    customer_phone: optionalString(order, 'customer_phone'),
    discount_amount: numberOrDefault(order, 'discount_amount', 0),
    gift_wrapping_fee: numberOrDefault(order, 'gift_wrapping_fee', 0),
    id: requiredString(order, 'id'),
    merchant_id:
      typeof order.merchant_id === 'string' && order.merchant_id.trim() !== ''
        ? order.merchant_id
        : context.merchantId,
    order_items: toRichPaidOrderItems(order.order_items),
    order_number: optionalString(order, 'order_number'),
    payment_status: 'paid',
    shipping_address: shippingAddress,
    shipping_fee: numberOrDefault(order, 'shipping_fee', 0),
    shipping_funding_source:
      order.shipping_funding_source === 'customer_checkout' ||
      order.shipping_funding_source === 'merchant_wallet'
        ? order.shipping_funding_source
        : null,
    shipping_platform_retained_amount: optionalMoney(
      order,
      'shipping_platform_retained_amount'
    ),
    shipping_provider: optionalString(order, 'shipping_provider'),
    // Nullable on legacy/imported orders; the old inline email path treated
    // it as 0, and a throw here would wedge the post-commit drain loop.
    subtotal: numberOrDefault(order, 'subtotal', 0),
    tax_amount: numberOrDefault(order, 'tax_amount', 0),
    tax_basis:
      order.tax_basis === 'exclusive' || order.tax_basis === 'inclusive'
        ? order.tax_basis
        : null,
    total: requiredNumber(order, 'total'),
  };
}
