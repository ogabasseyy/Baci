import { normalizeReceiverMatchText } from './international-quote-receiver-match';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import type { QuoteRequest } from './types';

export type QuoteComparableOrderItem = {
  name: string | null;
  price?: number | string | null;
  quantity: number | null;
  weight?: number | string | null;
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
};

function normalizeText(value: string | null | undefined): string {
  return normalizeReceiverMatchText(value);
}

function normalizeAmount(value: number | string | null | undefined) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function amountsMatch(
  orderValue: number | string | null | undefined,
  quoteValue: number
) {
  const normalizedOrderValue = normalizeAmount(orderValue);
  return (
    normalizedOrderValue !== undefined &&
    Math.abs(normalizedOrderValue - quoteValue) <= 0.001
  );
}

function hasPackageDimensions(item: {
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
}): boolean {
  return (
    normalizeAmount(item.length) !== undefined &&
    normalizeAmount(item.width) !== undefined &&
    normalizeAmount(item.height) !== undefined
  );
}

function dimensionsMatch(
  orderItem: QuoteComparableOrderItem,
  quoteItem: QuoteRequest['items'][number]
): boolean {
  const orderHasDimensions = hasPackageDimensions(orderItem);
  const quoteHasDimensions = hasPackageDimensions(quoteItem);

  // Both absent is fine (legacy quotes/items). Presence on only one side means
  // the attested rate was calculated without the current package size (or the
  // reverse) and must force a fresh quote.
  if (!orderHasDimensions && !quoteHasDimensions) return true;
  if (!orderHasDimensions || !quoteHasDimensions) return false;

  return (
    amountsMatch(orderItem.length, quoteItem.length as number) &&
    amountsMatch(orderItem.width, quoteItem.width as number) &&
    amountsMatch(orderItem.height, quoteItem.height as number)
  );
}

function matchesQuoteItem(
  orderItem: QuoteComparableOrderItem,
  quoteItem: QuoteRequest['items'][number]
): boolean {
  return (
    normalizeText(orderItem.name) === normalizeText(quoteItem.name) &&
    (orderItem.quantity ?? 1) === quoteItem.quantity &&
    amountsMatch(orderItem.price, quoteItem.value) &&
    (orderItem.weight === undefined ||
      amountsMatch(orderItem.weight, quoteItem.weight)) &&
    dimensionsMatch(orderItem, quoteItem)
  );
}

function throwItemsMismatch(message: string, code: string): never {
  throw new OrderShipmentBookingError(message, 400, code);
}

export function assertQuoteItemsMatchOrder(
  quoteRequest: QuoteRequest,
  orderItems: QuoteComparableOrderItem[] | null | undefined,
  mismatch: { message: string; code: string } = {
    message:
      'The saved shipping quote no longer matches this order. Please get a new quote before shipping.',
    code: 'SHIPPING_QUOTE_ITEMS_MISMATCH',
  }
): void {
  const items = orderItems ?? [];
  if (items.length !== quoteRequest.items.length) {
    throwItemsMismatch(mismatch.message, mismatch.code);
  }

  const unmatchedOrderItems = [...items];
  for (const quoteItem of quoteRequest.items) {
    const orderItemIndex = unmatchedOrderItems.findIndex((orderItem) =>
      matchesQuoteItem(orderItem, quoteItem)
    );
    if (orderItemIndex === -1) {
      throwItemsMismatch(mismatch.message, mismatch.code);
    }
    unmatchedOrderItems.splice(orderItemIndex, 1);
  }
}
