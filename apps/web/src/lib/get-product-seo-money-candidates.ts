import { CURRENCY_SYMBOLS } from './currency-meta';

export interface ProductSeoMoneyCandidate {
  start: number;
  end: number;
  marker: string;
  amount: number | null;
  rawAmount: string;
  currencies: string[];
  fallbackIsoCode?: boolean;
}

function getSupportedIsoCurrencies(): string[] | null {
  try {
    if (typeof Intl.supportedValuesOf === 'function')
      return Intl.supportedValuesOf('currency');
  } catch {
    // Some runtimes expose the API but do not implement the currency key.
  }
  return null;
}

const runtimeIsoCurrencies = getSupportedIsoCurrencies();
const isoCurrencies = new Set(
  runtimeIsoCurrencies ?? Object.keys(CURRENCY_SYMBOLS)
);
const useBoundedIsoFallback = runtimeIsoCurrencies === null;
const namedCurrencyAliases: Record<string, string[]> = {
  NAIRA: ['NGN'],
  NAIRAS: ['NGN'],
  'NIGERIAN NAIRA': ['NGN'],
  'NIGERIAN NAIRAS': ['NGN'],
  DOLLAR: ['currency-name:DOLLAR'],
  DOLLARS: ['currency-name:DOLLAR'],
  'US DOLLAR': ['USD'],
  'US DOLLARS': ['USD'],
  'CANADIAN DOLLAR': ['CAD'],
  'CANADIAN DOLLARS': ['CAD'],
  'AUSTRALIAN DOLLAR': ['AUD'],
  'AUSTRALIAN DOLLARS': ['AUD'],
  EURO: ['EUR'],
  EUROS: ['EUR'],
  POUND: ['GBP'],
  POUNDS: ['GBP'],
  YEN: ['JPY'],
  RUPEE: ['INR'],
  RUPEES: ['INR'],
  RAND: ['ZAR'],
  RANDS: ['ZAR'],
  CEDI: ['GHS'],
  CEDIS: ['GHS'],
  DIRHAM: ['AED'],
  DIRHAMS: ['AED'],
  SHILLING: ['KES', 'TZS', 'UGX'],
  SHILLINGS: ['KES', 'TZS', 'UGX'],
  PESO: ['currency-name:PESO'],
  PESOS: ['currency-name:PESO'],
};
const aliases: Record<string, string[]> = {};
for (const [code, symbol] of Object.entries(CURRENCY_SYMBOLS)) {
  const key = symbol.toUpperCase();
  aliases[key] ??= [];
  aliases[key].push(code);
}
aliases.N = ['NGN'];
aliases.US$ = ['USD'];
const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isoPattern = [...isoCurrencies].join('|');
const markerPattern = [...new Set([...isoCurrencies, ...Object.keys(aliases)])]
  .concat(Object.keys(namedCurrencyAliases))
  .sort((a, b) => b.length - a.length)
  .map(escapePattern)
  .join('|');
// Bounded token grammar: no rescanning arbitrarily long numeric/comma runs.
// Arabic-Indic and Eastern Arabic-Indic digits are supported alongside ASCII.
const digitPattern = '[0-9\\u0660-\\u0669\\u06f0-\\u06f9]';
const amountPattern = `(?:${digitPattern}{1,3}(?:[,\\u066c]${digitPattern}{3})+|${digitPattern}{1,3}(?:\\.${digitPattern}{3})+|${digitPattern}{1,2}(?:[,\\u066c]${digitPattern}{2})*[,\\u066c]${digitPattern}{3}|${digitPattern}{1,3}(?:[ '\\u2019\\u00a0\\u202f]${digitPattern}{3})+|${digitPattern}+)(?:(?:[.,]${digitPattern}{1,2})|(?:\\u066b${digitPattern}{1,3}))?(?:[kKmM])?`;
const taggedPattern = new RegExp(
  `(?<![\\p{L}\\p{N},.\\u066b\\u066c])(?:(?:(${isoPattern})\\s+)?(${markerPattern}|\\p{Sc})\\s*[:–—-]?\\s*(${amountPattern})(?:\\s*(${isoPattern}))?|(${amountPattern})\\s*[:–—-]?\\s*(${markerPattern}|\\p{Sc})(?:\\s*(${isoPattern}))?)(?![\\p{L}\\p{N}]|[.,\\u066b\\u066c](?=[\\p{N}]))`,
  'giu'
);
const fallbackTaggedPattern = useBoundedIsoFallback
  ? new RegExp(
      `(?<![\\p{L}\\p{N},.\\u066b\\u066c])(?:([A-Z]{3})\\s*[:–—-]?\\s*(${amountPattern})|(${amountPattern})\\s*[:–—-]?\\s*([A-Z]{3}))(?![\\p{L}\\p{N}]|[.,\\u066b\\u066c](?=[\\p{N}]))`,
      'gu'
    )
  : null;
const barePattern = new RegExp(
  `(?<![\\p{L}\\p{N},.\\u066b\\u066c])(${amountPattern})(?![\\p{L}\\p{N}]|,[\\s]*(?:[\\p{N}]|now\\b)|[.\\u066b\\u066c](?=[\\p{N}]))`,
  'giu'
);

function parseAmount(raw: string): number | null {
  const usesArabicDecimalSeparator = raw.includes('٫');
  const normalized = raw
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - '٠'.charCodeAt(0))
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - '۰'.charCodeAt(0))
    )
    .replace(/٬/g, ',')
    .replace(/٫/g, '.')
    .replace(/[.,]+$/, '')
    .toLowerCase();
  const suffix = normalized.match(/[km]$/)?.[0] ?? '';
  const amount = suffix ? normalized.slice(0, -1) : normalized;
  if (usesArabicDecimalSeparator) {
    const parts = amount.split('.');
    if (parts.length !== 2) return null;
    const [integer = '', fraction = ''] = parts;
    const groupedInteger = /^\d{1,3}(?:,\d{3})+$/.test(integer);
    const indianGroupedInteger = /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(integer);
    if (!/^\d+$/.test(integer) && !groupedInteger && !indianGroupedInteger)
      return null;
    if (!/^\d{1,3}$/.test(fraction)) return null;
    const decimal = `${integer.replace(/,/g, '')}.${fraction}`;
    const magnitude = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
    return Number(decimal) * magnitude;
  }
  const spaceGrouped =
    /^\d{1,3}([ '\u2019\u00a0\u202f])\d{3}(?:\1\d{3})*(?:[.,]\d{1,2})?$/.test(
      amount
    );
  let decimal = amount;

  if (spaceGrouped) {
    decimal = amount.replace(/[ '\u2019\u00a0\u202f]/g, '');
  } else if (/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(amount)) {
    decimal = amount.replace(/,/g, '');
  } else if (/^\d{1,3}(?:,\d{3})+$/.test(amount)) {
    decimal = amount.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(amount)) {
    decimal = amount.replace(/\./g, '');
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(amount)) {
    decimal = amount.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(amount)) {
    decimal = amount.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+(?:[.,]\d{1,2})?$/.test(amount)) {
    decimal = amount.replace(',', '.');
  } else {
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) return null;
  const magnitude = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Number(decimal) * magnitude;
}

function currencyCodes(marker: string): string[] {
  const code = marker.toUpperCase();
  if (Object.hasOwn(namedCurrencyAliases, code))
    return namedCurrencyAliases[code];
  return isoCurrencies.has(code)
    ? [code]
    : (aliases[code] ?? [`symbol:${code}`]);
}

/** Tokenizes bounded monetary spans without deciding whether prose is a price. */
export function getProductSeoMoneyCandidates(
  text: string
): ProductSeoMoneyCandidate[] {
  const tagged: ProductSeoMoneyCandidate[] = [
    ...text.matchAll(taggedPattern),
  ].map((match) => {
    const marker = match[2] || match[6];
    const rawAmount = match[3] || match[5];
    let currencies = currencyCodes(marker);
    for (const qualifier of [match[1], match[4], match[7]]) {
      if (qualifier)
        currencies = currencies.filter(
          (code) => code === qualifier.toUpperCase()
        );
    }
    return {
      start: match.index,
      end: match.index + match[0].length,
      marker,
      rawAmount,
      amount: parseAmount(rawAmount),
      currencies,
    };
  });
  if (fallbackTaggedPattern) {
    const fallbackTagged = [...text.matchAll(fallbackTaggedPattern)]
      .map((match) => {
        const marker = match[1] || match[4];
        const rawAmount = match[2] || match[3];
        return {
          start: match.index,
          end: match.index + match[0].length,
          marker,
          rawAmount,
          amount: parseAmount(rawAmount),
          currencies: [marker],
          fallbackIsoCode: true,
        };
      })
      .filter(
        (candidate) =>
          !isoCurrencies.has(candidate.marker) &&
          !Object.hasOwn(aliases, candidate.marker) &&
          !tagged.some(
            (known) =>
              known.start < candidate.end && candidate.start < known.end
          )
      );
    tagged.push(...fallbackTagged);
    tagged.sort((a, b) => a.start - b.start);
  }
  let taggedIndex = 0;
  const bare: ProductSeoMoneyCandidate[] = [];
  for (const match of text.matchAll(barePattern)) {
    const start = match.index;
    const end = start + match[0].length;
    while (tagged[taggedIndex] && tagged[taggedIndex].end <= start)
      taggedIndex++;
    if (tagged[taggedIndex] && tagged[taggedIndex].start < end) continue;
    bare.push({
      start,
      end,
      marker: '',
      amount: parseAmount(match[1]),
      rawAmount: match[1],
      currencies: [],
    });
  }
  return [...tagged, ...bare].sort((a, b) => a.start - b.start);
}
