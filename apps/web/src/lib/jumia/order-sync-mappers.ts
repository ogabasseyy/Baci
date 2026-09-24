import { randomBytes } from 'node:crypto';
import { sanitizeText } from '@/lib/sanitize-core';
import type { JumiaOrder, JumiaOrderItem } from '@/schemas/jumia';
import {
  calculateJumiaOrderMoney,
  mapJumiaPaymentStatus,
} from './order-sync-money';

export const JUMIA_EXTERNAL_SOURCE = 'jumia';
const JUMIA_DEFAULT_SHOP_ID = 'oauth';
const JUMIA_MARKETPLACE_EMAIL_DOMAIN = '@marketplace.usebaci.local';
const JUMIA_MARKETPLACE_EMAIL_PREFIX = 'jumia-';
const JUMIA_ORDER_NUMBER_PREFIX = 'JUMIA-';

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const SYNC_OVERLAP_MS = 10 * 60 * 1000;

/** Jumia order filters accept UTC timestamps at second precision only. */
export function formatJumiaOrderTimestamp(value: Date | number): string {
  const date = typeof value === 'number' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Cannot format an invalid Jumia order timestamp');
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface MarketplaceIntegrationRow {
  id: string;
  merchant_id: string;
  shop_id: string | null;
  last_sync_at: string | null;
  sync_config: unknown;
  country_code?: string | null;
  marketplace_key?: string | null;
  connection_method?: string | null;
  jumia_authorization_id?: string | null;
  /** The selected row is the cursor owner for a shared provider scope. */
  orderSyncScope?: 'shared';
}

export interface ExistingJumiaOrderRow {
  jumia_order_id: string;
  notification_sent: boolean | null;
  baci_order_id: string | null;
}

export interface ExistingOrderRow {
  id: string;
  external_id: string | null;
  tracking_token: string | null;
}

/**
 * Generates an opaque, URL-safe tracking token from 24 random bytes.
 *
 * The returned base64url string carries 192 bits of entropy and is intended
 * for non-guessable order tracking identifiers. It does not encode sensitive
 * data and should not be parsed for business meaning.
 */
export function buildTrackingToken(): string {
  return randomBytes(24).toString('base64url');
}

export function readOrderSyncEnabled(syncConfig: unknown): boolean {
  if (!syncConfig || typeof syncConfig !== 'object') return true;
  const orders = (syncConfig as { orders?: unknown }).orders;
  return orders !== false;
}

export function readStockSyncEnabled(syncConfig: unknown): boolean {
  if (!syncConfig || typeof syncConfig !== 'object') return false;
  return (syncConfig as { stock?: unknown }).stock === true;
}

export function getJumiaSyncLowerBound(
  lastSyncAt: string | null,
  nowMs = Date.now()
): string {
  if (!lastSyncAt) {
    return formatJumiaOrderTimestamp(nowMs - DEFAULT_LOOKBACK_MS);
  }

  const parsed = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(parsed)) {
    return formatJumiaOrderTimestamp(nowMs - DEFAULT_LOOKBACK_MS);
  }

  return formatJumiaOrderTimestamp(Math.max(0, parsed - SYNC_OVERLAP_MS));
}

export function getCustomerName(order: JumiaOrder): string {
  const address = order.shippingAddress;
  const name = `${address.firstName || ''} ${address.lastName || ''}`.trim();
  return sanitizeText(name || 'Jumia Customer', 200);
}

export type CanonicalShippingStatus =
  | 'delivered'
  | 'shipped'
  | 'cancelled'
  | 'returned'
  | 'processing'
  | 'pending';

export function mapJumiaShippingStatus(
  status: string
): CanonicalShippingStatus {
  const normalized = status.toLowerCase();
  if (normalized.includes('cancel') || normalized.includes('fail')) {
    return 'cancelled';
  }
  if (normalized.includes('return')) return 'returned';
  if (normalized.includes('delivered')) return 'delivered';
  if (normalized.includes('shipped') || normalized.includes('ready')) {
    return 'shipped';
  }
  if (normalized.includes('pack') || normalized.includes('process')) {
    return 'processing';
  }
  return 'pending';
}

export function buildJumiaOrderNumber(orderNumber: string): string {
  const normalized = sanitizeText(orderNumber, 120).trim().toUpperCase();
  if (!normalized) {
    throw new Error('Cannot build Jumia order number from empty input');
  }
  return normalized.startsWith(JUMIA_ORDER_NUMBER_PREFIX)
    ? normalized
    : `${JUMIA_ORDER_NUMBER_PREFIX}${normalized}`;
}

function buildMarketplaceEmail(orderId: string) {
  const safeId = orderId.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  return `${JUMIA_MARKETPLACE_EMAIL_PREFIX}${safeId}${JUMIA_MARKETPLACE_EMAIL_DOMAIN}`;
}

function sanitizeShippingAddress(address: JumiaOrder['shippingAddress']) {
  return {
    firstName: sanitizeText(address.firstName, 120),
    lastName: sanitizeText(address.lastName, 120),
    address: sanitizeText(address.address, 500),
    city: sanitizeText(address.city, 160),
    postalCode: sanitizeText(address.postalCode || '', 40),
    ward: sanitizeText(address.ward || '', 160),
    region: sanitizeText(address.region, 160),
    countryName: sanitizeText(address.countryName, 160),
  };
}

function sanitizeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function resolveJumiaOrderMarketplaceKey(
  integration: MarketplaceIntegrationRow
): string {
  return integration.orderSyncScope === 'shared'
    ? 'default'
    : integration.marketplace_key?.trim() || 'default';
}

export function buildJumiaCacheRow(
  integration: MarketplaceIntegrationRow,
  order: JumiaOrder,
  items: JumiaOrderItem[] | null,
  existing: ExistingJumiaOrderRow | undefined,
  baciOrderId: string
) {
  return {
    merchant_id: integration.merchant_id,
    jumia_order_id: order.id,
    jumia_order_number: sanitizeText(order.number, 120),
    jumia_shop_id: integration.shop_id || JUMIA_DEFAULT_SHOP_ID,
    marketplace_key: resolveJumiaOrderMarketplaceKey(integration),
    status: sanitizeText(order.status, 80),
    customer_name: getCustomerName(order),
    customer_phone: '',
    shipping_address: sanitizeShippingAddress(order.shippingAddress),
    items: items
      ? items.map((item) => ({
          id: item.id,
          product: {
            name: sanitizeText(item.product.name, 300),
            sellerSku: sanitizeText(item.product.sellerSku, 120),
            imageUrl: sanitizeHttpsUrl(item.product.imageUrl),
          },
          status: sanitizeText(item.status, 80),
          itemPrice: item.itemPrice,
          paidPrice: item.paidPrice,
        }))
      : undefined,
    total_amount: order.totalAmount.value,
    currency: order.totalAmount.currency,
    created_at_jumia: order.createdAt,
    baci_order_id: baciOrderId,
    notification_sent: existing?.notification_sent ?? false,
  };
}

export function buildCanonicalJumiaOrderPayload(
  integration: MarketplaceIntegrationRow,
  order: JumiaOrder,
  trackingToken: string,
  items: JumiaOrderItem[],
  importedAt = new Date().toISOString()
) {
  if (items.length === 0) {
    throw new Error(
      `Cannot build canonical Jumia order ${order.id} (${order.number}) without order items`
    );
  }

  const money = calculateJumiaOrderMoney(
    order.id,
    order.totalAmount.value,
    items
  );
  const shippingAddress = sanitizeShippingAddress(order.shippingAddress);
  const orderNumber = sanitizeText(order.number, 120);
  const jumiaStatus = sanitizeText(order.status, 80);
  const shippingStatus = mapJumiaShippingStatus(jumiaStatus);

  return {
    merchant_id: integration.merchant_id,
    order_number: buildJumiaOrderNumber(order.number),
    customer_name: getCustomerName(order),
    customer_email: buildMarketplaceEmail(order.id),
    customer_phone: '',
    shipping_status: shippingStatus,
    payment_status: mapJumiaPaymentStatus(shippingStatus, order.isPrepayment),
    total: money.total,
    subtotal: money.subtotal,
    shipping_fee: money.shippingFee,
    tax_amount: money.taxAmount,
    discount_amount: money.discountAmount,
    currency: order.totalAmount.currency,
    original_currency: order.totalAmount.currency,
    original_total: money.originalTotal,
    source: JUMIA_EXTERNAL_SOURCE,
    payment_method: JUMIA_EXTERNAL_SOURCE,
    notes: `Imported from Jumia order ${orderNumber}`,
    shipping_address: {
      address: shippingAddress.address,
      address_line1: shippingAddress.address,
      city: shippingAddress.city,
      state: shippingAddress.region,
      postal_code: shippingAddress.postalCode,
      country: shippingAddress.countryName,
    },
    tracking_token: trackingToken,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    external_source: JUMIA_EXTERNAL_SOURCE,
    external_id: order.id,
    imported_at: importedAt,
    import_metadata: {
      platform: JUMIA_EXTERNAL_SOURCE,
      shopId: integration.shop_id || JUMIA_DEFAULT_SHOP_ID,
      marketplaceKey: resolveJumiaOrderMarketplaceKey(integration),
      jumiaOrderId: order.id,
      jumiaOrderNumber: orderNumber,
      jumiaStatus,
      jumiaUpdatedAt: order.updatedAt,
    },
  };
}

export type JumiaCacheRow = ReturnType<typeof buildJumiaCacheRow>;

export function buildOrderItems(
  orderId: string,
  items: JumiaOrderItem[],
  importedAt = new Date().toISOString()
) {
  return items.map((item, index) => ({
    order_id: orderId,
    product_id: null,
    name: sanitizeText(item.product.name, 300),
    price: item.paidPrice ?? item.itemPrice,
    quantity: 1,
    image_url: sanitizeHttpsUrl(item.product.imageUrl),
    line_id: index + 1,
    line_extension_amount: item.paidPrice ?? item.itemPrice,
    item_description: sanitizeText(item.product.name, 300),
    sellers_item_id: sanitizeText(item.product.sellerSku, 120),
    fulfillment_data: {
      source_platform: JUMIA_EXTERNAL_SOURCE,
      jumia_order_item_id: item.id,
      seller_sku: sanitizeText(item.product.sellerSku, 120),
      status: sanitizeText(item.status, 80),
    },
    created_at: importedAt,
  }));
}
