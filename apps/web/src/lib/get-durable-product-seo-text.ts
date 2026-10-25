import { decodeHTML } from 'entities';
import { isDurableSeoDenomination } from './classify-durable-product-seo-denomination';
import { isClearlyNonRetailSeoAmount } from './classify-durable-product-seo-non-retail';
import { isDurableSeoPrice } from './classify-durable-product-seo-price';
import { getProductSeoMoneyCandidates } from './get-product-seo-money-candidates';
import { stripHtmlTags } from './sanitize-core';
import { stripVolatileProductPriceSentences } from './storefront-product-description';
import {
  getSeoProductName,
  normalizeSeoProductText,
} from './storefront-product-slug-disambiguation';

const MAX_SOURCE_LENGTH = 20_000;
const MAX_NAME_LENGTH = 1_000;
function removeIdentityIgnoringCase(text: string, identity: string): string {
  if (!identity) return text;
  const foldedIdentity = identity.toLowerCase();
  const foldedText = text.toLowerCase();
  const foldedOffsets: number[] = [];
  let sourceOffset = 0;
  for (const character of text) {
    const foldedCharacterLength = character.toLowerCase().length;
    for (let index = 0; index < foldedCharacterLength; index += 1)
      foldedOffsets.push(sourceOffset);
    sourceOffset += character.length;
  }
  let foldedCursor = 0;
  let sourceCursor = 0;
  let result = '';
  let matchIndex = foldedText.indexOf(foldedIdentity, foldedCursor);
  while (matchIndex >= 0) {
    const foldedEnd = matchIndex + foldedIdentity.length;
    const startsAtCharacterBoundary =
      matchIndex === 0 ||
      foldedOffsets[matchIndex] !== foldedOffsets[matchIndex - 1];
    const endsAtCharacterBoundary =
      foldedEnd === foldedText.length ||
      foldedOffsets[foldedEnd] !== foldedOffsets[foldedEnd - 1];
    if (startsAtCharacterBoundary && endsAtCharacterBoundary) {
      const sourceStart = foldedOffsets[matchIndex];
      const sourceEnd =
        foldedEnd === foldedText.length
          ? text.length
          : foldedOffsets[foldedEnd];
      result += text.slice(sourceCursor, sourceStart);
      sourceCursor = sourceEnd;
      foldedCursor = foldedEnd;
    } else {
      foldedCursor = matchIndex + 1;
    }
    matchIndex = foldedText.indexOf(foldedIdentity, foldedCursor);
  }
  return result + text.slice(sourceCursor);
}

/** Keeps editorial copy price-free across currencies; offers supply live prices. */
export function getDurableProductSeoText({
  text,
  product,
}: {
  text: string | null | undefined;
  product: { name: string; slug?: string | null };
}): string {
  if (
    typeof text !== 'string' ||
    text.length > MAX_SOURCE_LENGTH ||
    product.name.length > MAX_NAME_LENGTH ||
    (product.slug?.length ?? 0) > MAX_NAME_LENGTH
  )
    return '';
  const productName = stripHtmlTags(decodeHTML(getSeoProductName(product)));
  const plainText = stripHtmlTags(
    decodeHTML(
      normalizeSeoProductText(stripVolatileProductPriceSentences(text), product)
    )
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !plainText ||
    /\bconfirm specs\W+condition\W+variants\W+(?:and\W+)?availability\b/i.test(
      plainText
    )
  )
    return '';
  const monetaryText = productName.trim()
    ? [
        productName,
        stripHtmlTags(decodeHTML(getSeoProductName({ name: product.name }))),
      ].reduce((result, identity) => {
        return removeIdentityIgnoringCase(result, identity);
      }, plainText)
    : plainText;
  const denominations = /\b(?:gift[- ]cards?|vouchers?)\b/i.test(productName)
    ? getProductSeoMoneyCandidates(productName).filter((value) => value.marker)
    : [];
  const hasRetailPrice = getProductSeoMoneyCandidates(monetaryText).some(
    (candidate) => {
      return (
        isDurableSeoPrice(candidate, monetaryText) &&
        !isClearlyNonRetailSeoAmount(candidate, monetaryText) &&
        !isDurableSeoDenomination(
          candidate,
          monetaryText,
          productName,
          denominations
        )
      );
    }
  );
  if (hasRetailPrice || !/[\p{L}\p{N}]/u.test(monetaryText)) return '';
  return plainText;
}
