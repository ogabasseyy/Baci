import { CURRENCY_SYMBOLS } from './currency-meta';
import { stripHtmlTags } from './sanitize-core';
import { stripVolatileProductPriceSentences } from './storefront-product-description';
import {
  getSeoProductName,
  normalizeSeoProductText,
} from './storefront-product-slug-disambiguation';

// Share the storefront's display aliases and recognize foreign ISO amounts too.
const isoCurrencies = new Set(Intl.supportedValuesOf('currency'));
const currencyTokens = [
  ...new Set([
    ...isoCurrencies,
    ...Object.keys(CURRENCY_SYMBOLS),
    ...Object.values(CURRENCY_SYMBOLS),
  ]),
].sort((a, b) => b.length - a.length);
const currencyPattern = currencyTokens
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const moneyPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(${currencyPattern})\\s*(\\d[\\d.,]*)|(\\d[\\d.,]*)\\s*(${currencyPattern}))(?![\\p{L}\\p{N}])`,
  'giu'
);
const denominationLabelPattern = new RegExp(
  `^(?:\\s+(?:${currencyPattern}))?\\s+(?:value|credit|denomination|gift[- ]card)\\b`,
  'iu'
);

function moneyIdentity(match: RegExpMatchArray) {
  const token = (match[1] || match[4]).toUpperCase();
  return {
    amount: (match[2] || match[3])
      .replace(/[.,]+$/, '')
      .replace(/,/g, '')
      .replace(/\.0+$/, ''),
    currencies: isoCurrencies.has(token)
      ? [token]
      : Object.entries(CURRENCY_SYMBOLS)
          .filter(([, symbol]) => symbol.toUpperCase() === token)
          .map(([code]) => code),
  };
}

/** Keeps useful editorial overrides; prices must come from current offer data. */
export function getDurableProductSeoText({
  text,
  product,
  currency,
}: {
  text: string | null | undefined;
  product: { name: string; slug?: string | null };
  currency: string;
}): string {
  const productName = getSeoProductName(product);
  const plainText = stripHtmlTags(
    normalizeSeoProductText(stripVolatileProductPriceSentences(text), product)
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!plainText) return '';

  if (
    /\bconfirm specs\W+condition\W+variants\W+(?:and\W+)?availability\b/i.test(
      plainText
    )
  ) {
    return '';
  }

  // A gift-card denomination is identity, not its current retail price. Remove
  // that exact identity before checking for other monetary amounts.
  let monetaryText = productName.trim()
    ? plainText.replace(
        new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        ''
      )
    : plainText;
  if (/\bgift[- ]card\b/i.test(productName)) {
    const denominations = [...productName.matchAll(moneyPattern)].map(
      moneyIdentity
    );
    // Remove only a matching face value explicitly labelled as identity. A
    // "buy for" amount remains a retail claim even if it equals the face value.
    const identityMatches = [...monetaryText.matchAll(moneyPattern)].filter(
      (match) => {
        const claim = moneyIdentity(match);
        return (
          denominations.some(
            (value) =>
              value.amount === claim.amount &&
              value.currencies.some((code) => claim.currencies.includes(code))
          ) &&
          denominationLabelPattern.test(
            monetaryText.slice(match.index + match[0].length)
          )
        );
      }
    );
    for (const match of identityMatches.reverse()) {
      monetaryText = `${monetaryText.slice(0, match.index)} ${monetaryText.slice(match.index + match[0].length)}`;
    }
  }
  const hasSymbolAmount = /\p{Sc}\s*\d|\d\s*\p{Sc}/u.test(monetaryText);
  const hasCodeAmount = [...monetaryText.matchAll(moneyPattern)].some(
    // A bare compact R16 is also a model token outside a rand storefront.
    // Spaced rand amounts and every unambiguous currency remain monetary.
    (match) => {
      const token = match[1] || match[4];
      const code = token.toUpperCase();
      // ISO codes like ALL, TOP and TRY are ordinary words too: require
      // ISO casing or explicit price language, including the local currency.
      if (
        isoCurrencies.has(code) &&
        token !== code &&
        !/\b(?:buy|price|pay|costs?|sale)\b/i.test(monetaryText)
      )
        return false;
      return !/^r\d/i.test(match[0]) || currency.toUpperCase() === 'ZAR';
    }
  );
  // Only grouped numbers in shopping/price context: model years, storage,
  // RAM and quantities such as "storage for 4,000 photos" remain editorial.
  const hasUnlabelledPrice =
    /\b(?:price|from|starts?\s+at|costs?|(?:buy|shop|get|purchase)\b[^.!?]{0,200}\bfor)\s*[:–—-]?\s*\d{1,3}(?:,\d{3})+(?![\p{L}\p{N}])/iu.test(
      monetaryText
    );

  return hasSymbolAmount || hasCodeAmount || hasUnlabelledPrice
    ? ''
    : plainText;
}
