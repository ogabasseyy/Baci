import { OrderQuoteDestinationMismatchError } from './order-quote-destination-errors';
import type { parseStoredQuoteRequest } from './order-shipment-booking-utils';
import type { ShippingProviderCode } from './types';

type QuoteDestinationRecord = {
  price?: number | string | null;
  provider?: string | null;
};

type PhysicalQuoteMetadata = {
  height?: number;
  hsCode?: string;
  length?: number;
  weight?: number;
  width?: number;
};

type CheckoutItemForQuote = PhysicalQuoteMetadata & {
  name: string | null;
  negotiatedPrice?: number;
  price?: number | string | null;
  quantity: number | null;
  value?: number;
};

export type QuoteCheckoutContext = {
  items?: CheckoutItemForQuote[];
  merchantId?: string;
  shippingFee?: number;
  shippingProvider?: ShippingProviderCode | string | null;
};

function throwQuoteMismatch(code: string, status = 400): never {
  throw new OrderQuoteDestinationMismatchError(
    'The saved shipping quote no longer matches this checkout. Please get a new quote before checkout.',
    code,
    status
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function readComparableItemValue(item: CheckoutItemForQuote): number {
  return Number(item.negotiatedPrice ?? item.value ?? item.price);
}

function hasComparableItemValue(item: CheckoutItemForQuote): boolean {
  return (
    item.negotiatedPrice !== undefined ||
    item.value !== undefined ||
    (item.price !== undefined && item.price !== null)
  );
}

function numbersMatch(
  left: number | undefined,
  right: number | undefined
): boolean {
  if (left === undefined) return true;
  if (right === undefined) return false;
  return Math.abs(left - right) <= 0.001;
}

function hasDimensions(
  item: Pick<PhysicalQuoteMetadata, 'height' | 'length' | 'width'>
): boolean {
  return (
    item.length !== undefined ||
    item.width !== undefined ||
    item.height !== undefined
  );
}

function matchesQuotePhysicalMetadata(
  checkoutItem: PhysicalQuoteMetadata,
  quoteItem: PhysicalQuoteMetadata
): boolean {
  if (!numbersMatch(checkoutItem.weight, quoteItem.weight)) {
    return false;
  }

  if (hasDimensions(checkoutItem) || hasDimensions(quoteItem)) {
    if (!hasDimensions(checkoutItem)) return true;
    if (
      !numbersMatch(checkoutItem.length, quoteItem.length) ||
      !numbersMatch(checkoutItem.width, quoteItem.width) ||
      !numbersMatch(checkoutItem.height, quoteItem.height)
    ) {
      return false;
    }
  }

  const checkoutHsCode = normalizeText(checkoutItem.hsCode);
  if (!checkoutHsCode) return true;
  return checkoutHsCode === normalizeText(quoteItem.hsCode);
}

function matchesQuoteItem(
  checkoutItem: CheckoutItemForQuote,
  quoteItem: NonNullable<
    ReturnType<typeof parseStoredQuoteRequest>
  >['items'][number]
): boolean {
  return (
    normalizeText(checkoutItem.name) === normalizeText(quoteItem.name) &&
    checkoutItem.quantity === quoteItem.quantity &&
    (!hasComparableItemValue(checkoutItem) ||
      readComparableItemValue(checkoutItem) === quoteItem.value) &&
    matchesQuotePhysicalMetadata(checkoutItem, quoteItem)
  );
}

export function validateQuoteCheckoutContext(
  quote: QuoteDestinationRecord,
  quoteRequest: NonNullable<ReturnType<typeof parseStoredQuoteRequest>>,
  context: QuoteCheckoutContext
): void {
  if (!context.shippingProvider || !quote.provider) {
    throwQuoteMismatch('INTERNATIONAL_QUOTE_PROVIDER_MISMATCH');
  }

  if (quote.provider !== context.shippingProvider) {
    throwQuoteMismatch('INTERNATIONAL_QUOTE_PROVIDER_MISMATCH');
  }

  if (
    context.merchantId &&
    (!quoteRequest.merchantId || quoteRequest.merchantId !== context.merchantId)
  ) {
    throwQuoteMismatch('INTERNATIONAL_QUOTE_MERCHANT_MISMATCH');
  }

  const quotePrice = Number(quote.price);
  if (
    typeof context.shippingFee === 'number' &&
    Number.isFinite(quotePrice) &&
    context.shippingFee !== quotePrice
  ) {
    throwQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
  }

  if (!context.items) return;
  if (context.items.length !== quoteRequest.items.length) {
    throwQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
  }

  const unmatchedCheckoutItems = [...context.items];
  for (const quoteItem of quoteRequest.items) {
    const matchIndex = unmatchedCheckoutItems.findIndex((checkoutItem) =>
      matchesQuoteItem(checkoutItem, quoteItem)
    );
    if (matchIndex === -1) {
      throwQuoteMismatch('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
    }
    unmatchedCheckoutItems.splice(matchIndex, 1);
  }
}

export function throwOrderQuoteMismatch(code: string, status = 400): never {
  throwQuoteMismatch(code, status);
}
