export { computeNegotiationCounterOffer as computeCounterOffer } from '@baci/shared/lib';

export const AI_REVIEW_MESSAGE =
  'Your offer was accepted by our AI and is subject to human review.';
export const FINAL_PRICE_MESSAGE =
  "That's the final price for this product. We can't discount it further.";
export const COUNTER_OFFER_REPLIES = [
  "That's a bit low. But I can do:",
  "We're getting closer. The best I can do is:",
  'This is my absolute final offer:',
] as const;
