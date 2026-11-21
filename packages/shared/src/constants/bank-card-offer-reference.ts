// The database prefixes a hyphenless PostgreSQL UUID with BCO-.
export const BANK_CARD_OFFER_REFERENCE_PATTERN = /^BCO-[a-f0-9]{32}$/;

// Reserve the namespace for routing, then validate the exact reference.
export function hasBankCardOfferReferencePrefix(
  reference: string | null | undefined
): boolean {
  return /^BCO-/i.test(reference ?? '');
}
