import type {
  InternationalShipmentOrderItem,
  ProductShippingMetadata,
} from '@/lib/shipping/international-shipment-items';
import { toInternationalQuoteValidationItemsFromOrder } from '@/lib/shipping/international-shipment-items';
import type { OrderShippingAddressForQuote } from '@/lib/shipping/order-quote-destination';
import { shippingCoordinatePairSchema } from '@/schemas/order-shipping-address';

type ReuseOrderQuoteValidationContext = {
  order_items: ReturnType<typeof toInternationalQuoteValidationItemsFromOrder>;
  selected_quote_id: string | null;
  shipping_address: OrderShippingAddressForQuote | undefined;
  shipping_fee: number | string | null;
  shipping_provider: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOrderShippingAddress(
  value: unknown
): OrderShippingAddressForQuote | undefined {
  if (!isRecord(value)) return undefined;
  const address = value.address;
  const city = value.city;
  const state = value.state;
  if (
    typeof address !== 'string' ||
    typeof city !== 'string' ||
    typeof state !== 'string'
  ) {
    return undefined;
  }

  const pin = shippingCoordinatePairSchema.safeParse(value);
  if (!pin.success) return undefined;

  return {
    ...pin.data,
    address,
    city,
    country: typeof value.country === 'string' ? value.country : undefined,
    countryCode:
      typeof value.countryCode === 'string' ? value.countryCode : undefined,
    postalCode:
      typeof value.postalCode === 'string' ? value.postalCode : undefined,
    state,
  };
}

function readProductShippingMetadata(
  value: unknown
): ProductShippingMetadata | null {
  if (!isRecord(value)) return null;
  return {
    commodity_code:
      typeof value.commodity_code === 'string' ? value.commodity_code : null,
    dimensions: value.dimensions,
    weight_unit:
      typeof value.weight_unit === 'string' ? value.weight_unit : null,
    weight_value:
      typeof value.weight_value === 'number' ||
      typeof value.weight_value === 'string'
        ? value.weight_value
        : null,
  };
}

function readOrderQuoteItem(
  value: unknown
): InternationalShipmentOrderItem | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const quantity = value.quantity;
  return {
    name: typeof name === 'string' ? name : null,
    price:
      typeof value.price === 'number' || typeof value.price === 'string'
        ? value.price
        : null,
    product: readProductShippingMetadata(value.product),
    quantity: typeof quantity === 'number' ? quantity : null,
  };
}

export function readReuseQuoteValidationContext(
  data: unknown
): ReuseOrderQuoteValidationContext | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) return null;

  const shippingFee = row.shipping_fee;
  const shippingProvider = row.shipping_provider;
  const selectedQuoteId = row.selected_quote_id;
  const orderItems = Array.isArray(row.order_items)
    ? row.order_items.flatMap((item) => {
        const parsed = readOrderQuoteItem(item);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    order_items: toInternationalQuoteValidationItemsFromOrder(orderItems, {
      includeValue: true,
    }),
    selected_quote_id:
      typeof selectedQuoteId === 'string' ? selectedQuoteId : null,
    shipping_address: readOrderShippingAddress(row.shipping_address),
    shipping_fee:
      typeof shippingFee === 'number' || typeof shippingFee === 'string'
        ? shippingFee
        : null,
    shipping_provider:
      typeof shippingProvider === 'string' ? shippingProvider : null,
  };
}

export function readOptionalShippingFee(value: number | string | null): number {
  return typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
}
