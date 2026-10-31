/**
 * OpenAI product-feed eligibility for every legacy feed row. Search stays on.
 * Checkout stays off: OpenAI enables native checkout per approved integration
 * and no Baci merchant has one recorded, so opting a row in would claim a
 * checkout OpenAI cannot use (F6). `enable_search` and `enable_checkout` are
 * the accepted aliases of `is_eligible_search` and `is_eligible_checkout`
 * (https://developers.openai.com/commerce/specs/file-upload/products).
 */
export const OPENAI_LEGACY_FEED_ELIGIBILITY = {
  enable_checkout: false,
  enable_search: true,
} as const;
