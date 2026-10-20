import {
  getMoneyCurrencyExponent,
  normalizeMoneyCurrency,
  resolveMoneyLocale,
} from './currency-locales';

export type MoneyFormatter = (amount: number) => string;

/**
 * Caller formatting options. `style` and `currency` are excluded: the
 * currency-code argument is the single source of truth and cannot be
 * overridden through options.
 */
export interface FormatMoneyOptions
  extends Omit<Intl.NumberFormatOptions, 'style' | 'currency'> {
  /** Explicit locale override; defaults to the currency-derived locale. */
  locale?: string;
}

const MAX_FORMATTER_CACHE_SIZE = 100;

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Shared Intl.NumberFormat factory (bounded LRU cache). Construction
 * errors (invalid currency code, invalid explicit locale, invalid
 * option values) propagate to the caller instead of being masked by a
 * fallback reformat; a well-formed but unsupported locale is handled by
 * Intl's own internal fallback and does not throw.
 */
export function getMoneyFormatter(
  currencyCode: string,
  options: FormatMoneyOptions = {}
): Intl.NumberFormat {
  const { locale: localeOverride, ...numberFormatOptions } = options;
  const currency = normalizeMoneyCurrency(currencyCode);
  const locale = localeOverride ?? resolveMoneyLocale(currency);
  const exponent = getMoneyCurrencyExponent(currency);
  const finalOptions: Intl.NumberFormatOptions = {
    ...numberFormatOptions,
    style: 'currency',
    currency,
    minimumFractionDigits:
      numberFormatOptions.minimumFractionDigits ?? exponent,
    maximumFractionDigits:
      numberFormatOptions.maximumFractionDigits ?? exponent,
  };
  const cacheKey = `${locale}:${JSON.stringify(finalOptions)}`;

  const cached = formatterCache.get(cacheKey);
  if (cached) {
    // Refresh recency so eviction drops the least recently used entry.
    formatterCache.delete(cacheKey);
    formatterCache.set(cacheKey, cached);
    return cached;
  }

  const formatter = new Intl.NumberFormat(locale, finalOptions);
  if (formatterCache.size >= MAX_FORMATTER_CACHE_SIZE) {
    const oldest = formatterCache.keys().next().value;
    if (oldest !== undefined) formatterCache.delete(oldest);
  }
  formatterCache.set(cacheKey, formatter);
  return formatter;
}
