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
const RECEIPT_TIME_ZONE = 'Africa/Lagos';

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

export function normalizeReceiptDocumentDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return date;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RECEIPT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );

  const year = values.year as number;
  const month = values.month as number;
  const day = values.day as number;

  return new Date(Date.UTC(year, month - 1, day));
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
    timeZone: RECEIPT_TIME_ZONE,
  });
}
