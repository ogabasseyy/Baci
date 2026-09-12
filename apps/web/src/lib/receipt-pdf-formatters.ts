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

const _receiptCurrencyFormatterCache = new Map<string, Intl.NumberFormat>();

function getReceiptCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = _receiptCurrencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(
      CURRENCY_LOCALE_MAP[currency] || 'en-NG',
      {
        style: 'currency',
        currency,
      }
    );
    _receiptCurrencyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

export function formatReceiptCurrency(amount: number, currency: string) {
  return getReceiptCurrencyFormatter(currency).format(amount);
}

export function formatReceiptDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
