import { retailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

export function isDurableSeoDenomination(
  candidate: ProductSeoMoneyCandidate,
  text: string,
  productName: string,
  denominations: ProductSeoMoneyCandidate[]
): boolean {
  if (
    !candidate.marker ||
    retailRelation(text, candidate.start).cue ||
    retailRelation(text, candidate.start).predicate
  )
    return false;
  if (
    !denominations.some(
      (value) =>
        (value.amount !== null && candidate.amount !== null
          ? value.amount === candidate.amount
          : value.amount === null &&
            candidate.amount === null &&
            value.rawAmount.replace(/[.,]+$/, '').toLowerCase() ===
              candidate.rawAmount.replace(/[.,]+$/, '').toLowerCase()) &&
        value.currencies.some((code) => candidate.currencies.includes(code))
    )
  )
    return false;
  const followingLabel =
    /^\s+((?:[\p{L}][\p{L}\p{N}'-]{0,30}\s+){0,4})(?:gift[- ]card|voucher|value|credit|denomination)\b/iu.exec(
      text.slice(candidate.end)
    );
  const precedingLabel = /\b(?:gift[- ]cards?|vouchers?|denomination)\b/i.test(
    text
      .slice(Math.max(0, candidate.start - 120), candidate.start)
      .split(/[.!?;\n]/)
      .at(-1) ?? ''
  );
  if (!followingLabel && !precedingLabel) return false;
  const identityWords = new Set(
    productName.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? []
  );
  if (followingLabel) {
    const matchesIdentity = followingLabel[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => identityWords.has(word.toLowerCase()));
    if (matchesIdentity) return true;
  }
  if (precedingLabel) {
    const hasGiftCardIdentity =
      identityWords.has('gift') ||
      identityWords.has('card') ||
      identityWords.has('cards') ||
      identityWords.has('voucher') ||
      identityWords.has('vouchers');
    if (hasGiftCardIdentity) return true;
  }
  return false;
}
