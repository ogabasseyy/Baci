import { readPackageDimensionsCm } from './package-dimensions';
import { productWeightToKg } from './product-weight-to-kg';
import type { QuoteRequest, ShipmentItem, ShippingAddress } from './types';

const DEFAULT_ORDER_ITEM_WEIGHT_KG = 1;

type OrderItem = {
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
  product_id?: string | null;
  weight_value?: number | null;
  weight_unit?: string | null;
};
type OrderLike = {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  shipping_address?: unknown;
  order_items?: OrderItem[] | null;
};
type ProductLookup = (ids: string[]) => Promise<
  Record<
    string,
    {
      weight_value?: number | null;
      weight_unit?: string | null;
      commodity_code?: string | null;
      dimensions?: unknown;
    }
  >
>;

export type OrderGiglQuoteBuildResult =
  | { ok: true; request: QuoteRequest }
  | {
      ok: false;
      code:
        | 'ORDER_SHIPPING_ADDRESS_INCOMPLETE'
        | 'ORDER_SHIPPING_ITEMS_EMPTY'
        | 'ORDER_SHIPPING_ITEM_INVALID'
        | 'ORDER_SHIPPING_HS_CODE_REQUIRED';
      missing?: string[];
      status: number;
    };

function weightKg(value: unknown, unit: unknown): number | null {
  return productWeightToKg(value, unit);
}

function finiteCoordinate(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= minimum && value <= maximum
      ? value
      : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function readNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function readAddress(raw: unknown, order: OrderLike): ShippingAddress {
  const a =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    name: String(a.name ?? order.customer_name ?? ''),
    phone: String(a.phone ?? order.customer_phone ?? ''),
    email: String(a.email ?? order.customer_email ?? ''),
    address: String(a.address ?? a.street ?? ''),
    city: String(a.city ?? ''),
    state: String(a.state ?? ''),
    country: readNonEmptyString(a.country, 'Nigeria'),
    countryCode: readNonEmptyString(a.countryCode ?? a.country_code, 'NG'),
    postalCode: typeof a.postalCode === 'string' ? a.postalCode : undefined,
    latitude: finiteCoordinate(a.latitude, -90, 90),
    longitude: finiteCoordinate(a.longitude, -180, 180),
  };
}

function isNigeriaDestination(address: ShippingAddress): boolean {
  const countryCode = String(address.countryCode ?? '')
    .trim()
    .toUpperCase();
  const country = String(address.country ?? '')
    .trim()
    .toLowerCase();

  // Older manually created Nigerian orders may have stored blank country
  // metadata. Admin GIGL is already restricted to Nigerian merchants, so keep
  // those addresses on the domestic path while still rejecting any explicit
  // foreign country or country code below.
  if (!country && !countryCode) return true;

  if (
    country &&
    country !== 'nigeria' &&
    country !== 'ng' &&
    country !== 'nga'
  ) {
    return false;
  }
  if (countryCode && countryCode !== 'NG' && countryCode !== 'NGA') {
    return false;
  }

  return (
    countryCode === 'NG' ||
    countryCode === 'NGA' ||
    country === 'nigeria' ||
    country === 'ng' ||
    country === 'nga'
  );
}

export async function buildOrderGiglQuoteRequest(
  order: OrderLike,
  sender: ShippingAddress,
  lookupProducts: ProductLookup = async () => ({}),
  receiverOverride?: Partial<ShippingAddress>
): Promise<OrderGiglQuoteBuildResult> {
  const storedReceiver = readAddress(order.shipping_address, order);
  const overrideAddressChanged =
    receiverOverride?.address !== undefined &&
    String(receiverOverride.address).trim() !==
      String(storedReceiver.address).trim();
  const overrideHasCompleteCoordinates =
    finiteCoordinate(receiverOverride?.latitude, -90, 90) !== undefined &&
    finiteCoordinate(receiverOverride?.longitude, -180, 180) !== undefined;
  const receiver = {
    ...storedReceiver,
    ...receiverOverride,
    ...(overrideAddressChanged && !overrideHasCompleteCoordinates
      ? { latitude: undefined, longitude: undefined }
      : {}),
  };
  const shipmentType = isNigeriaDestination(receiver)
    ? 'domestic'
    : 'international';
  const hasFiniteCoordinates =
    Number.isFinite(receiver.latitude) && Number.isFinite(receiver.longitude);
  const required =
    shipmentType === 'domestic' && hasFiniteCoordinates
      ? (['address', 'phone'] as const)
      : (['address', 'city', 'state', 'phone'] as const);
  const missing = required.filter((key) => !String(receiver[key] ?? '').trim());
  if (missing.length)
    return {
      ok: false,
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing,
      status: 422,
    };
  const rows = order.order_items ?? [];
  if (!rows.length)
    return { ok: false, code: 'ORDER_SHIPPING_ITEMS_EMPTY', status: 400 };
  const ids = rows.flatMap((item) =>
    item.product_id ? [item.product_id] : []
  );
  const products = await lookupProducts(ids);
  const items: ShipmentItem[] = [];
  for (const item of rows) {
    const quantity = Number(item.quantity ?? 1);
    if (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(quantity)
    )
      return { ok: false, code: 'ORDER_SHIPPING_ITEM_INVALID', status: 400 };
    const product = item.product_id ? products[item.product_id] : undefined;
    const weight =
      weightKg(item.weight_value, item.weight_unit) ??
      weightKg(product?.weight_value, product?.weight_unit) ??
      DEFAULT_ORDER_ITEM_WEIGHT_KG;
    const hsCode = product?.commodity_code?.trim() || undefined;
    if (shipmentType === 'international' && !hsCode) {
      return {
        ok: false,
        code: 'ORDER_SHIPPING_HS_CODE_REQUIRED',
        status: 422,
      };
    }
    const dimensions = readPackageDimensionsCm(product?.dimensions);
    items.push({
      name: String(item.name ?? 'Item'),
      quantity,
      weight,
      value: Number(item.price ?? 0),
      ...(hsCode ? { hsCode } : {}),
      ...(dimensions ?? {}),
    });
  }
  return {
    ok: true,
    request: {
      sessionId: order.id,
      sender,
      receiver,
      items,
      shipmentType,
      deliveryPreference: 'door',
    },
  };
}
