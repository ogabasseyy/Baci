import { stripHtmlTags } from './sanitize-core';
import { stripVolatileProductPriceSentences } from './storefront-product-description';

const ELLIPSIS = '...';
const ELLIPSIS_LENGTH = ELLIPSIS.length;
const DEFAULT_MAX_LENGTH = 160;
const DEFAULT_MIN_LENGTH = 0;

function validateMaxLength(value: number): number {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    value <= ELLIPSIS_LENGTH
  ) {
    return DEFAULT_MAX_LENGTH;
  }
  return value;
}

function normalizePlainText(value: string): string {
  return stripHtmlTags(value).replace(/\s+/g, ' ').trim();
}

function truncateAtCodePointBoundary(value: string, maxLength: number): string {
  const truncated = value.substring(0, maxLength);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);

  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? truncated.substring(0, truncated.length - 1)
    : truncated;
}

/**
 * Generates a meta description from product description if not provided.
 */
export function generateMetaDescription(
  description: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
  options?: {
    minLength?: number;
    fallback?: string;
  }
): string {
  const validMaxLength = validateMaxLength(maxLength);
  const minLength = Math.max(DEFAULT_MIN_LENGTH, options?.minLength ?? 0);

  const fallbackPlainText = options?.fallback
    ? stripVolatileProductPriceSentences(normalizePlainText(options.fallback))
    : '';

  // Strip HTML tags using iterative sanitization to prevent incomplete removal
  // of nested patterns like <scr<script>ipt>
  const plainText = stripVolatileProductPriceSentences(
    normalizePlainText(description)
  );

  const baseDescription = plainText || fallbackPlainText;
  if (!baseDescription) {
    return '';
  }

  let candidateDescription = baseDescription;

  if (
    minLength > 0 &&
    candidateDescription.length < minLength &&
    fallbackPlainText
  ) {
    if (candidateDescription !== fallbackPlainText) {
      const normalizedBase = /[.!?]$/.test(candidateDescription)
        ? candidateDescription
        : `${candidateDescription}.`;
      const mergedDescription = `${normalizedBase} ${fallbackPlainText}`.trim();
      candidateDescription =
        mergedDescription.length > candidateDescription.length
          ? mergedDescription
          : candidateDescription;
    }
  }

  if (candidateDescription.length <= validMaxLength) {
    return candidateDescription;
  }

  return (
    truncateAtCodePointBoundary(
      candidateDescription,
      validMaxLength - ELLIPSIS_LENGTH
    ) + ELLIPSIS
  );
}
