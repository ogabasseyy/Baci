import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { productWeightToKg } from './product-weight-to-kg';
import type { ShipmentItem } from './types';

export type ProductShippingMetadata = {
  weight_value?: number | string | null;
  weight_unit?: string | null;
  dimensions?: unknown;
  commodity_code?: string | null;
};

export type InternationalShipmentOrderItem = {
  name: string | null;
  quantity: number | null;
  price: number | string | null;
  product?: ProductShippingMetadata | ProductShippingMetadata[] | null;
  products?: ProductShippingMetadata | ProductShippingMetadata[] | null;
};

type PackageDimensions = Pick<ShipmentItem, 'length' | 'width' | 'height'>;
type DerivedItemMetadata = Pick<
  ShipmentItem,
  'hsCode' | 'name' | 'quantity' | 'weight'
> & {
  dimensions: PackageDimensions | undefined;
  product: ProductShippingMetadata | null;
};
const METADATA_TOLERANCE = 0.001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function readNonNegativeNumber(value: unknown, itemName: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  throw new OrderShipmentBookingError(
    `Order item "${itemName}" has an invalid price and cannot be shipped internationally.`,
    400,
    'INTERNATIONAL_ITEM_INVALID_VALUE'
  );
}

function readOptionalNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : undefined;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function readProductMetadata(
  item: InternationalShipmentOrderItem
): ProductShippingMetadata | null {
  const relatedProduct = item.product ?? item.products;
  const product = Array.isArray(relatedProduct)
    ? relatedProduct[0]
    : relatedProduct;
  return isRecord(product) ? product : null;
}

function readSupportedProductWeightKg(
  product: ProductShippingMetadata | null
): number | undefined {
  return (
    productWeightToKg(product?.weight_value, product?.weight_unit) ?? undefined
  );
}

function normalizeWeightKg(product: ProductShippingMetadata | null): number {
  return readSupportedProductWeightKg(product) ?? 1;
}

function hasProductWeight(product: ProductShippingMetadata | null): boolean {
  return readSupportedProductWeightKg(product) !== undefined;
}

function normalizeDimensionCm(
  value: unknown,
  unit: string | undefined
): number | undefined {
  const dimension = readPositiveNumber(value);
  if (!dimension) return undefined;

  const multiplier = { in: 2.54, m: 100, mm: 0.1 }[unit?.toLowerCase() ?? ''];
  return dimension * (multiplier ?? 1);
}

function readPackageDimensions(
  product: ProductShippingMetadata | null
): PackageDimensions | undefined {
  const dimensions = product?.dimensions;
  if (!isRecord(dimensions)) return undefined;

  const unit =
    typeof dimensions.unit === 'string' ? dimensions.unit : undefined;
  const length = normalizeDimensionCm(
    dimensions.length ?? dimensions.depth,
    unit
  );
  const width = normalizeDimensionCm(dimensions.width, unit);
  const height = normalizeDimensionCm(dimensions.height, unit);

  return length && width && height ? { length, width, height } : undefined;
}

function deriveItemMetadata(
  item: InternationalShipmentOrderItem
): DerivedItemMetadata {
  const product = readProductMetadata(item);
  return {
    product,
    hsCode: product?.commodity_code?.trim() || undefined,
    dimensions: readPackageDimensions(product),
    name: item.name || 'Order item',
    quantity: Math.max(1, item.quantity ?? 1),
    weight: normalizeWeightKg(product),
  };
}

function numbersMatch(left: number | undefined, right: number | undefined) {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(left - right) <= METADATA_TOLERANCE;
}

function dimensionsMatch(
  expected: PackageDimensions | undefined,
  quoted: ShipmentItem
): boolean {
  const quotedDimensions = readQuoteDimensions(quoted);
  if (!expected && !quotedDimensions) return true;
  if (!expected || !quotedDimensions) return false;
  return (
    numbersMatch(expected.length, quotedDimensions.length) &&
    numbersMatch(expected.width, quotedDimensions.width) &&
    numbersMatch(expected.height, quotedDimensions.height)
  );
}

function isQuotedPhysicalMetadataValid({
  dimensions,
  hsCode,
  product,
  quoteItem,
  weight,
}: {
  dimensions: PackageDimensions | undefined;
  hsCode?: string;
  product: ProductShippingMetadata | null;
  quoteItem: ShipmentItem;
  weight: number;
}) {
  return !(
    (hasProductWeight(product) && !numbersMatch(weight, quoteItem.weight)) ||
    (hsCode &&
      quoteItem.hsCode?.trim() &&
      hsCode.toUpperCase() !== quoteItem.hsCode.trim().toUpperCase()) ||
    (dimensions && !dimensionsMatch(dimensions, quoteItem))
  );
}

function readQuoteDimensions(
  quoteItem: ShipmentItem | undefined
): PackageDimensions | undefined {
  return quoteItem?.length === undefined ||
    quoteItem.width === undefined ||
    quoteItem.height === undefined
    ? undefined
    : {
        height: quoteItem.height,
        length: quoteItem.length,
        width: quoteItem.width,
      };
}

function resolveBookingMetadata(
  metadata: DerivedItemMetadata,
  quoteItem: ShipmentItem | undefined
) {
  return {
    dimensions: metadata.dimensions ?? readQuoteDimensions(quoteItem),
    hsCode: metadata.hsCode ?? quoteItem?.hsCode?.trim() ?? undefined,
    weight:
      hasProductWeight(metadata.product) || quoteItem?.weight === undefined
        ? metadata.weight
        : quoteItem.weight,
  };
}

function findMatchingQuoteItemIndex(
  metadata: DerivedItemMetadata,
  quoteItems: ShipmentItem[]
): number {
  const itemName = normalizeText(metadata.name);
  const matchingIndexes = quoteItems
    .map((quoteItem, index) => ({ index, quoteItem }))
    .filter(
      ({ quoteItem }) =>
        normalizeText(quoteItem.name) === itemName &&
        quoteItem.quantity === metadata.quantity
    );

  return (
    matchingIndexes.find(({ quoteItem }) =>
      isQuotedPhysicalMetadataValid({ ...metadata, quoteItem })
    )?.index ??
    matchingIndexes[0]?.index ??
    -1
  );
}

function throwMetadataMismatch(): never {
  throw new OrderShipmentBookingError(
    'The saved international shipping quote no longer matches the current product shipping details. Please get a new quote before shipping.',
    400,
    'INTERNATIONAL_QUOTE_ITEM_METADATA_MISMATCH'
  );
}

function validateQuotedPhysicalMetadata(
  metadata: DerivedItemMetadata,
  quoteItem: ShipmentItem | undefined
) {
  if (!quoteItem) return;

  if (!isQuotedPhysicalMetadataValid({ ...metadata, quoteItem })) {
    throwMetadataMismatch();
  }
}

export function toInternationalShipmentItemsFromOrder(
  orderItems: InternationalShipmentOrderItem[],
  quoteItems: ShipmentItem[] = []
): ShipmentItem[] {
  const unmatchedQuoteItems = [...quoteItems];

  return orderItems.map((item) => {
    const metadata = deriveItemMetadata(item);
    const { name, quantity } = metadata;
    const quoteItemIndex = findMatchingQuoteItemIndex(
      metadata,
      unmatchedQuoteItems
    );
    const quoteItem =
      quoteItemIndex === -1
        ? undefined
        : unmatchedQuoteItems.splice(quoteItemIndex, 1)[0];
    validateQuotedPhysicalMetadata(metadata, quoteItem);
    const bookingMetadata = resolveBookingMetadata(metadata, quoteItem);

    return {
      name,
      description: name,
      quantity,
      weight: bookingMetadata.weight,
      value:
        readOptionalNonNegativeNumber(quoteItem?.value) ??
        readNonNegativeNumber(item.price, name),
      ...(bookingMetadata.hsCode ? { hsCode: bookingMetadata.hsCode } : {}),
      ...(bookingMetadata.dimensions ?? {}),
    };
  });
}

export function toInternationalQuoteValidationItemsFromOrder(
  orderItems: InternationalShipmentOrderItem[],
  options: { includeValue?: boolean } = {}
) {
  return orderItems.map((item) => {
    const { dimensions, hsCode, name, product, quantity, weight } =
      deriveItemMetadata(item);
    const value = options.includeValue
      ? readOptionalNonNegativeNumber(item.price)
      : undefined;

    return {
      name,
      quantity,
      ...(hasProductWeight(product) ? { weight } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(hsCode ? { hsCode } : {}),
      ...(dimensions ?? {}),
    };
  });
}
