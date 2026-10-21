import { CURRENCY_SYMBOLS } from './currency-meta';

export interface ProductSeoMoneyCandidate {
  start: number;
  end: number;
  marker: string;
  amount: number | null;
  rawAmount: string;
  currencies: string[];
}

const isoCurrencies = new Set(Intl.supportedValuesOf('currency'));
const aliases: Record<string, string[]> = {};
for (const [code, symbol] of Object.entries(CURRENCY_SYMBOLS)) {
  const key = symbol.toUpperCase();
  aliases[key] ??= [];
  aliases[key].push(code);
}
aliases.N = ['NGN'];
const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isoPattern = [...isoCurrencies].join('|');
const markerPattern = [...new Set([...isoCurrencies, ...Object.keys(aliases)])]
  .sort((a, b) => b.length - a.length)
  .map(escapePattern)
  .join('|');
// Bounded token grammar: no rescanning arbitrarily long numeric/comma runs.
const amountPattern = '\\d[\\d,.]{0,30}(?:[km])?';
const taggedPattern = new RegExp(
  `(?<![\\p{L}\\p{N},.])(?:(?:(${isoPattern})\\s+)?(${markerPattern}|\\p{Sc})\\s*(${amountPattern})(?:\\s*(${isoPattern}))?|(${amountPattern})\\s*(${markerPattern}|\\p{Sc})(?:\\s*(${isoPattern}))?)(?![\\p{L}\\p{N},])`,
  'giu'
);
const barePattern = new RegExp(
  `(?<![\\p{L}\\p{N},.])(${amountPattern})(?![\\p{L}\\p{N},])`,
  'giu'
);

function parseAmount(raw: string): number | null {
  const normalized = raw.replace(/[.,]+$/, '').toLowerCase();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[km]?$/.test(normalized))
    return null;
  const magnitude = normalized.endsWith('m')
    ? 1_000_000
    : normalized.endsWith('k')
      ? 1_000
      : 1;
  return Number(normalized.replace(/,/g, '').replace(/[km]$/, '')) * magnitude;
}

function currencyCodes(marker: string): string[] {
  const code = marker.toUpperCase();
  return isoCurrencies.has(code)
    ? [code]
    : (aliases[code] ?? [`symbol:${code}`]);
}

/** Tokenizes bounded monetary spans without deciding whether prose is a price. */
export function getProductSeoMoneyCandidates(
  text: string
): ProductSeoMoneyCandidate[] {
  const tagged = [...text.matchAll(taggedPattern)].map((match) => {
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
