import {
  getMoneyDisplayExponent,
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
  const exponent = getMoneyDisplayExponent(currency);
  // Resolve the fraction-digit pair jointly: a single supplied bound
  // must not combine with the exponent default into min > max (which
  // Intl rejects). The omitted bound derives from the supplied one.
  const minOption = numberFormatOptions.minimumFractionDigits;
  const maxOption = numberFormatOptions.maximumFractionDigits;
  const finalOptions: Intl.NumberFormatOptions = {
    ...numberFormatOptions,
    style: 'currency',
    currency,
    minimumFractionDigits:
      minOption ??
      (maxOption !== undefined ? Math.min(exponent, maxOption) : exponent),
    maximumFractionDigits:
      maxOption ??
      (minOption !== undefined ? Math.max(exponent, minOption) : exponent),
  };
  // Canonical key: sorted entries so logically identical options in
  // different property order share one cache entry.
  const cacheKey = `${locale}:${JSON.stringify(
    Object.entries(finalOptions)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  )}`;

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
