import {
  type CurrencyConfig,
  formatCurrencyWithConfig,
  getCurrencyConfig,
} from '@/lib/currency';

const ADMIN_CURRENCY_CONFIG = {
  code: 'NGN',
  locale: 'en-NG',
  symbol: '₦',
} as const satisfies CurrencyConfig;

/**
 * Switches whole-naira admin metrics to compact notation from ₦1K upward.
 */
const ADMIN_COMPACT_CURRENCY_THRESHOLD = 1000;

function parseCurrencyValue(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const numericValue =
    typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatUnknownCurrency(value: number, currencyCode: string): string {
  const isCompact = value >= ADMIN_COMPACT_CURRENCY_THRESHOLD;
  const amount = new Intl.NumberFormat('en', {
    maximumFractionDigits: isCompact ? 1 : 2,
    minimumFractionDigits: isCompact ? 0 : 2,
    notation: isCompact ? 'compact' : 'standard',
  }).format(value);
  return `${currencyCode} ${amount}`;
}

export function formatAdminCurrency(
  value: number | string | null | undefined,
  options?: Partial<Intl.NumberFormatOptions>
): string {
  return formatCurrencyWithConfig(
    parseCurrencyValue(value),
    ADMIN_CURRENCY_CONFIG,
    options
  );
}

export function formatAdminCompactCurrency(
  value: number | string | null | undefined,
  options?: Partial<Intl.NumberFormatOptions>
): string {
  return formatAdminCurrency(value, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
    notation: 'compact',
    ...options,
  });
}

export function formatAdminThresholdCurrency(
  value: number | string | null | undefined
): string {
  const numericValue = parseCurrencyValue(value);

  return numericValue >= ADMIN_COMPACT_CURRENCY_THRESHOLD
    ? formatAdminCompactCurrency(numericValue)
    : formatAdminCurrency(numericValue);
}

/** Formats a bounded admin amount without silently relabelling another currency as NGN. */
export function formatAdminThresholdCurrencyForCode(
  value: number | string | null | undefined,
  currencyCode: string
): string {
  const numericValue = parseCurrencyValue(value);
  const normalizedCode = currencyCode.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedCode)) {
    return formatUnknownCurrency(numericValue, 'UNK');
  }

  const config = getCurrencyConfig(null, normalizedCode);
  if (config.code !== normalizedCode) {
    return formatUnknownCurrency(numericValue, normalizedCode);
  }

  return formatCurrencyWithConfig(numericValue, config, {
    maximumFractionDigits:
      numericValue >= ADMIN_COMPACT_CURRENCY_THRESHOLD ? 1 : 2,
    minimumFractionDigits:
      numericValue >= ADMIN_COMPACT_CURRENCY_THRESHOLD ? 0 : 2,
    notation:
      numericValue >= ADMIN_COMPACT_CURRENCY_THRESHOLD ? 'compact' : 'standard',
  });
}
