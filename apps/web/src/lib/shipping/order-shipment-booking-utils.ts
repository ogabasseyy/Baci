import type {
  QuoteRequest,
  ShipmentItem,
  ShippingAddress,
  ShippingProviderCode,
  ShippingQuote,
} from '@/lib/shipping/types';
import { SHIPPING_PROVIDER_CODES } from '@/lib/shipping/types';
import { matchesGiglProviderRate } from './matches-gigl-provider-rate';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import { readPackageDimensionsCm } from './package-dimensions';

export { OrderShipmentBookingError };

type OrderItemRecord = {
  name: string | null;
  quantity: number | null;
  price: number | string | null;
};

export function isShippingProviderCode(
  value: string | null | undefined
): value is ShippingProviderCode {
  return (SHIPPING_PROVIDER_CODES as readonly string[]).includes(value ?? '');
}

function isShippingAddress(value: unknown): value is ShippingAddress {
  if (!value || typeof value !== 'object') return false;

  const address = value as Partial<ShippingAddress>;

  return (
    typeof address.name === 'string' &&
    typeof address.phone === 'string' &&
    typeof address.address === 'string' &&
    typeof address.city === 'string' &&
    typeof address.state === 'string'
  );
}

function isShipmentItem(value: unknown): value is ShipmentItem {
  if (!value || typeof value !== 'object') return false;

  const item = value as Partial<ShipmentItem>;
  const quantity = item.quantity;
  const weight = item.weight;
  const itemValue = item.value;

  return (
    typeof item.name === 'string' &&
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    typeof weight === 'number' &&
    Number.isFinite(weight) &&
    weight > 0 &&
    typeof itemValue === 'number' &&
    Number.isFinite(itemValue) &&
    itemValue >= 0
  );
}

export function parseStoredQuoteRequest(value: unknown): QuoteRequest | null {
  if (!value || typeof value !== 'object') return null;

  const quoteRequest = value as Partial<QuoteRequest>;

  if (!isShippingAddress(quoteRequest.receiver)) return null;
  if (
    !Array.isArray(quoteRequest.items) ||
    !quoteRequest.items.every(isShipmentItem)
  ) {
    return null;
  }

  return {
    ...(quoteRequest.deliveryPreference === 'door' ||
    quoteRequest.deliveryPreference === 'pickup_station'
      ? { deliveryPreference: quoteRequest.deliveryPreference }
      : {}),
    merchantId:
      typeof quoteRequest.merchantId === 'string' &&
      quoteRequest.merchantId.trim().length > 0
        ? quoteRequest.merchantId
        : undefined,
    sessionId:
      typeof quoteRequest.sessionId === 'string' &&
      quoteRequest.sessionId.length > 0
        ? quoteRequest.sessionId
        : crypto.randomUUID(),
    shipmentType:
      quoteRequest.shipmentType === 'international'
        ? 'international'
        : 'domestic',
    ...(quoteRequest.admin_order_provenance === 'server_gigl_v1'
      ? { admin_order_provenance: 'server_gigl_v1' as const }
      : {}),
    sender: isShippingAddress(quoteRequest.sender)
      ? {
          ...quoteRequest.sender,
          country: quoteRequest.sender.country || 'Nigeria',
          countryCode: quoteRequest.sender.countryCode || 'NG',
        }
      : undefined,
    receiver: {
      ...quoteRequest.receiver,
      country: quoteRequest.receiver.country || 'Nigeria',
      countryCode: quoteRequest.receiver.countryCode || 'NG',
    },
    items: quoteRequest.items,
  };
}

export function toShipmentItems(orderItems: OrderItemRecord[]): ShipmentItem[] {
  return orderItems.map((item) => ({
    name: item.name || 'Order item',
    description: item.name || 'Order item',
    quantity: Math.max(1, item.quantity ?? 1),
    weight: 1,
    value: Number(item.price || 0),
  }));
}

export function toDomesticBookingItems(
  orderItems: OrderItemRecord[],
  quoteItems: ShipmentItem[] | undefined
): ShipmentItem[] {
  if (!quoteItems?.length) return toShipmentItems(orderItems);
  return quoteItems.map((item) => ({
    name: item.name,
    description: item.description || item.name,
    quantity: item.quantity,
    weight: item.weight,
    value: item.value,
    ...(item.hsCode ? { hsCode: item.hsCode } : {}),
    ...(item.length !== undefined ? { length: item.length } : {}),
    ...(item.width !== undefined ? { width: item.width } : {}),
    ...(item.height !== undefined ? { height: item.height } : {}),
  }));
}

export function quotedShipmentItemWeight(item: {
  product?: {
    weight_value?: number | string | null;
    weight_unit?: string | null;
  } | null;
  products?:
    | {
        weight_value?: number | string | null;
        weight_unit?: string | null;
      }
    | Array<{
        weight_value?: number | string | null;
        weight_unit?: string | null;
      }>
    | null;
}): number | undefined {
  const related = item.product ?? item.products;
  const product = Array.isArray(related) ? related[0] : related;
  const value = Number(product?.weight_value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Match buildOrderGiglQuoteRequest: only kg/g are supported. Unsupported
  // units (lb/oz/…) fall through to the caller's 1 kg default so booking
  // comparisons stay aligned with the quoted tariff.
  const unit = String(product?.weight_unit ?? 'kg').toLowerCase();
  if (unit !== 'kg' && unit !== 'g') return undefined;
  return unit === 'g' ? value * 0.001 : value;
}

export function toQuoteComparableOrderItems(
  items: unknown,
  options: { defaultWeight?: number } = {}
) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as {
      name?: string | null;
      quantity?: number | null;
      price?: number | string | null;
      length?: number | string | null;
      width?: number | string | null;
      height?: number | string | null;
      product?: Parameters<typeof quotedShipmentItemWeight>[0]['product'] & {
        dimensions?: unknown;
      };
      products?: Parameters<typeof quotedShipmentItemWeight>[0]['products'] & {
        dimensions?: unknown;
      };
    };
    const related = record.product ?? record.products;
    const product = Array.isArray(related) ? related[0] : related;
    const dimensions =
      readPackageDimensionsCm(
        product && typeof product === 'object' && 'dimensions' in product
          ? product.dimensions
          : undefined
      ) ??
      readPackageDimensionsCm({
        length: record.length,
        width: record.width,
        height: record.height,
      });
    return [
      {
        name: record.name ?? null,
        quantity: record.quantity ?? null,
        price: record.price,
        weight: quotedShipmentItemWeight(record) ?? options.defaultWeight,
        ...(dimensions ?? {}),
      },
    ];
  });
}

export function selectPreferredQuote(
  quotes: ShippingQuote[],
  currentQuote: {
    serviceTier: string | null;
    carrierName: string | null;
    providerRateId?: string | null;
  }
): ShippingQuote | null {
  const normalizedServiceTier = currentQuote.serviceTier?.toLowerCase() ?? null;
  const normalizedCarrierName = currentQuote.carrierName?.toLowerCase() ?? null;
  const normalizedProviderRateId = currentQuote.providerRateId?.trim() || null;

  return (
    quotes.find(
      (quote) =>
        normalizedProviderRateId &&
        quote.providerRateId === normalizedProviderRateId
    ) ||
    quotes.find(
      (quote) =>
        normalizedProviderRateId &&
        matchesGiglProviderRate(normalizedProviderRateId, quote.providerRateId)
    ) ||
    quotes.find(
      (quote) =>
        quote.serviceTier.toLowerCase() === normalizedServiceTier &&
        quote.carrierName.toLowerCase() === normalizedCarrierName
    ) ||
    quotes.find(
      (quote) => quote.serviceTier.toLowerCase() === normalizedServiceTier
    ) ||
    quotes[0] ||
    null
  );
}

export { buildOrderShipmentReceiver as buildReceiver } from './build-order-shipment-receiver';
export { deriveMerchantLocation } from './merchant-location';
export { domesticSendersDiffer } from './merchant-sender-comparison';
