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

const CURRENCY_LOCALE_MAP: Record<string, string> = {
  NGN: 'en-NG',
  GHS: 'en-GH',
  KES: 'en-KE',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  ZAR: 'en-ZA',
  XAF: 'fr-CM',
  XOF: 'fr-SN',
};

const MONEY_TOLERANCE = 0.01;
export const DEFAULT_NG_VAT_RATE = 7.5;

export type MoneyFormatter = (amount: number) => string;

const moneyFormatterCache = new Map<string, Intl.NumberFormat>();

function getMoneyFormatter(currencyCode: string): Intl.NumberFormat {
  const cached = moneyFormatterCache.get(currencyCode);
  if (cached) {
    return cached;
  }

  const locale = CURRENCY_LOCALE_MAP[currencyCode] || 'en-NG';
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  moneyFormatterCache.set(currencyCode, formatter);
  return formatter;
}

export function createMoneyFormatter(currencyCode: string): MoneyFormatter {
  const formatter = getMoneyFormatter(currencyCode);
  return (amount) => formatter.format(amount);
}

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
  const locale = CURRENCY_LOCALE_MAP[currencyCode.toUpperCase()];
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

// Narrow item view for shared line math: the single source both the HTML
// preview renderer and the emailed/downloaded PDF renderer consume, so the
// two can never disagree on line totals or detail labels again.
export interface ReceiptLineItemLike {
  price: number;
  quantity: number;
  line_extension_amount?: number | null;
  unit_code?: string | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  sellers_item_id?: string | null;
}

export function getReceiptItemLineTotal(item: ReceiptLineItemLike): number {
  return typeof item.line_extension_amount === 'number' &&
    Number.isFinite(item.line_extension_amount)
    ? item.line_extension_amount
    : item.price * item.quantity;
}

export function getReceiptItemVatLines(
  item: ReceiptLineItemLike,
  formatMoney: MoneyFormatter
): string[] {
  const lines: string[] = [];
  if (typeof item.vat_rate === 'number' && Number.isFinite(item.vat_rate)) {
    lines.push(`VAT: ${item.vat_rate.toFixed(2)}%`);
  }
  if (typeof item.vat_amount === 'number' && Number.isFinite(item.vat_amount)) {
    lines.push(formatMoney(item.vat_amount));
  }
  return lines;
}

export function getReceiptItemDetailLines(item: ReceiptLineItemLike): string[] {
  const lines: string[] = [];
  if (item.sellers_item_id) lines.push(`SKU: ${item.sellers_item_id}`);
  if (item.unit_code) lines.push(`Unit: ${item.unit_code}`);
  return lines;
}
