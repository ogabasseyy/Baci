import { MONEY_CURRENCY_LOCALES } from '../money/currency-locales';
import type { ReceiptMerchant, ReceiptOrder } from './types';

// Narrow views of the receipt types so VAT presentation logic can be reused
// by callers (e.g. the mobile admin order screen) that don't hold a full
// receipt payload. Full Receipt* objects satisfy these automatically.
export type VatBreakdownOrder = Pick<
  ReceiptOrder,
  | 'currency'
  | 'discount_amount'
  | 'shipping_fee'
  | 'subtotal'
  | 'tax_amount'
  | 'total'
>;
export type VatBreakdownMerchant = Pick<
  ReceiptMerchant,
  'vat_rate' | 'vat_registration_status'
>;

const MONEY_TOLERANCE = 0.01;
export const DEFAULT_NG_VAT_RATE = 7.5;

// The money formatter now lives in ../money (formatting wave
// extraction); re-exported here so receipt callers keep their
// existing imports and there is one formatter/cache in the package.
export { createMoneyFormatter } from '../money/create-money-formatter';
export type { MoneyFormatter } from '../money/money-formatter';

export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  const r = Number.parseInt(cleaned.substring(0, 2), 16);
  const g = Number.parseInt(cleaned.substring(2, 4), 16);
  const b = Number.parseInt(cleaned.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(26, 26, 46, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getStoredAmountPrecision(amount: number): number {
  const [, fraction = ''] = Math.abs(amount).toString().split('.');
  return fraction.replace(/0+$/, '').length;
}

function roundToPrecision(amount: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(amount * scale) / scale;
}

function storedAmountMatchesComputed(
  storedAmount: number,
  computedAmount: number
): boolean {
  const precision = getStoredAmountPrecision(storedAmount);
  return (
    roundToPrecision(storedAmount, precision) ===
    roundToPrecision(computedAmount, precision)
  );
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MONEY_TOLERANCE;
}

function getTaxExclusiveTotal(order: VatBreakdownOrder): number {
  return order.subtotal - order.discount_amount + order.shipping_fee;
}

function getIncludedTaxAmount(total: number, taxRate: number): number {
  return total - total / (1 + taxRate / 100);
}

function getDefaultVatRateForCurrency(currencyCode: string): number | null {
  const locale = MONEY_CURRENCY_LOCALES[currencyCode.toUpperCase()];
  return locale === 'en-NG' ? DEFAULT_NG_VAT_RATE : null;
}

export function getReceiptVatRate(
  merchant: VatBreakdownMerchant,
  currencyCode: string
): number | null {
  const vatRate = merchant.vat_rate;
  if (vatRate === null) {
    return getDefaultVatRateForCurrency(currencyCode);
  }

  if (
    typeof vatRate !== 'number' ||
    !Number.isFinite(vatRate) ||
    vatRate <= 0
  ) {
    return null;
  }

  return vatRate;
}

function isTaxExclusiveTotal(order: VatBreakdownOrder): boolean {
  return almostEqual(
    order.total,
    getTaxExclusiveTotal(order) + order.tax_amount
  );
}

function hasTaxInclusiveTotalShape(order: VatBreakdownOrder): boolean {
  return (
    almostEqual(order.total, getTaxExclusiveTotal(order)) ||
    // Admin fallbacks can backfill a missing subtotal with the inclusive total.
    almostEqual(order.subtotal, order.total)
  );
}

function isTaxInclusiveTotal(
  order: VatBreakdownOrder,
  merchant: VatBreakdownMerchant
): boolean {
  const vatRate = getReceiptVatRate(merchant, order.currency);
  if (vatRate === null) {
    return false;
  }

  return (
    hasTaxInclusiveTotalShape(order) &&
    storedAmountMatchesComputed(
      order.tax_amount,
      getIncludedTaxAmount(order.total, vatRate)
    )
  );
}

export function shouldShowVatLine(
  order: VatBreakdownOrder,
  merchant: VatBreakdownMerchant
): boolean {
  if (
    merchant.vat_registration_status !== 'registered' ||
    order.tax_amount <= 0
  ) {
    return false;
  }

  return isTaxExclusiveTotal(order) || isTaxInclusiveTotal(order, merchant);
}

export function getReceiptDisplaySubtotal(
  order: VatBreakdownOrder,
  merchant: VatBreakdownMerchant
): number {
  if (
    !shouldShowVatLine(order, merchant) ||
    !isTaxInclusiveTotal(order, merchant)
  ) {
    return order.subtotal;
  }

  const displaySubtotal =
    order.total - order.tax_amount - order.shipping_fee + order.discount_amount;
  return displaySubtotal >= 0 ? displaySubtotal : order.subtotal;
}
