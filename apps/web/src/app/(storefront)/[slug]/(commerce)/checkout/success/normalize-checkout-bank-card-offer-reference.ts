import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';

export function normalizeCheckoutBankCardOfferReference(
  reference: string | null
): string | null {
  if (reference?.slice(0, 4).toUpperCase() !== 'BCO-') return null;
  const parsed = bankCardOfferReferenceSchema.safeParse(
    `BCO-${reference.slice(4).toLowerCase()}`
  );
  return parsed.success ? parsed.data : null;
}
