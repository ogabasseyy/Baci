const formatterCache = new Map<string, Intl.NumberFormat>();
const currencyFractionDigitsCache = new Map<string, number>();
const MIN_FRACTION_DIGITS = 0;
const MAX_FRACTION_DIGITS = 20;
const CURRENCY_LOCALE_MAP: Record<string, string> = {
  NGN: 'en-NG',
  INR: 'en-IN',
  GHS: 'en-GH',
  KES: 'en-KE',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  ZAR: 'en-ZA',
  XAF: 'fr-CM',
  XOF: 'fr-SN',
  CAD: 'en-CA',
  AUD: 'en-AU',
  BRL: 'pt-BR',
  JPY: 'ja-JP',
};

type DisplayCurrencyOptions = Pick<
  Intl.NumberFormatOptions,
  'currencyDisplay' | 'minimumFractionDigits' | 'maximumFractionDigits'
>;

function getFormatterCacheKey(
  currency: string,
  options: DisplayCurrencyOptions
) {
  return [
    currency,
    options.currencyDisplay,
    options.minimumFractionDigits,
    options.maximumFractionDigits,
  ].join(':');
}

function normalizeFractionDigits(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(MIN_FRACTION_DIGITS, Math.trunc(value))
  );
}

function getDefaultMaximumFractionDigits(currency: string, locale: string) {
  const cacheKey = `${locale}:${currency}`;
  const cached = currencyFractionDigitsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const resolved = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  const normalized = normalizeFractionDigits(resolved) ?? 2;
  currencyFractionDigitsCache.set(cacheKey, normalized);
  return normalized;
}

function normalizeDisplayCurrencyOptions(
  options: DisplayCurrencyOptions,
  defaultMaximumFractionDigits: number
) {
  const normalizedOptions: DisplayCurrencyOptions = {
    currencyDisplay: options.currencyDisplay ?? 'symbol',
  };
  const minimumFractionDigits = normalizeFractionDigits(
    options.minimumFractionDigits
  );
  const maximumFractionDigits = normalizeFractionDigits(
    options.maximumFractionDigits
  );

  if (minimumFractionDigits !== undefined) {
    normalizedOptions.minimumFractionDigits = minimumFractionDigits;
  }

  if (maximumFractionDigits !== undefined) {
    normalizedOptions.maximumFractionDigits = Math.max(
      maximumFractionDigits,
      minimumFractionDigits ?? MIN_FRACTION_DIGITS
    );
  } else if (minimumFractionDigits !== undefined) {
    normalizedOptions.maximumFractionDigits = Math.max(
      defaultMaximumFractionDigits,
      minimumFractionDigits
    );
  }

  return normalizedOptions;
}

function getDisplayCurrencyLocale(currency = 'NGN') {
  return CURRENCY_LOCALE_MAP[currency.toUpperCase()] || 'en-US';
}

export function formatDisplayCurrency(
  amount: number,
  currency = 'NGN',
  options: DisplayCurrencyOptions = {}
) {
  try {
    return formatWithDisplayCurrency(amount, currency, options);
  } catch {
    // A display formatter must never crash its page — but it must
    // never mislabel money either. Legacy rows can store codes Intl
    // rejects, so preserve the stored code instead of rendering NGN.
    const code = currency.trim() === '' ? 'NGN' : currency;
    return `${code} ${amount.toFixed(2)}`;
  }
}

function formatWithDisplayCurrency(
  amount: number,
  currency: string,
  options: DisplayCurrencyOptions
) {
  // Legacy rows can store padded codes (' NGN '); Intl rejects them,
  // so trim before uppercasing.
  const normalizedCurrency = currency.trim().toUpperCase();
  const locale = getDisplayCurrencyLocale(normalizedCurrency);
  const defaultMaximumFractionDigits = getDefaultMaximumFractionDigits(
    normalizedCurrency,
    locale
  );
  const normalizedOptions = normalizeDisplayCurrencyOptions(
    options,
    defaultMaximumFractionDigits
  );
  const cacheKey = getFormatterCacheKey(normalizedCurrency, normalizedOptions);
  let formatter = formatterCache.get(cacheKey);

  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      ...normalizedOptions,
    });
    formatterCache.set(cacheKey, formatter);
  }

  return formatter.format(amount);
}
