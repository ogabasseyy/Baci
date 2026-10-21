import { stripHtmlTags } from './sanitize-core';
import { stripVolatileProductPriceSentences } from './storefront-product-description';
import {
  getSeoProductName,
  normalizeSeoProductText,
} from './storefront-product-slug-disambiguation';

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

  const lowerText = plainText.toLowerCase();
  if (
    lowerText.startsWith('buy ') &&
    lowerText.includes(' in ') &&
    lowerText.includes(' from ') &&
    lowerText.endsWith('. confirm specs, condition, variants and availability.')
  ) {
    return '';
  }

  // A gift-card denomination is identity, not its current retail price. Remove
  // that exact identity before checking for other monetary amounts.
  let monetaryText = productName.trim()
    ? plainText.toLowerCase().split(productName.toLowerCase()).join('')
    : plainText;
  const denominations =
    productName
      .toLowerCase()
      .match(/(?:\p{Sc}|[a-z]{3})\s*\d[\d.,]*(?:\s+[a-z]{3}\b)?/gu) ?? [];
  for (const denomination of denominations) {
    for (const label of ['value', 'credit', 'denomination']) {
      monetaryText = monetaryText.replaceAll(`${denomination} ${label}`, '');
    }
  }
  const hasSymbolAmount = /\p{Sc}\s*\d|\d\s*\p{Sc}/u.test(monetaryText);
  const codeAmounts = [
    ...monetaryText.matchAll(/\b([a-z]{3})\s*\d/gi),
    ...monetaryText.matchAll(/\d\s*([a-z]{3})\b/gi),
  ];
  const hasCodeAmount = codeAmounts.some(
    (match) => match[1].toUpperCase() === currency.toUpperCase()
  );

  return hasSymbolAmount || hasCodeAmount ? '' : plainText;
}
