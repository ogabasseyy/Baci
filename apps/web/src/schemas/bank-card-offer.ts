import { z } from 'zod';

const cardBrand = z.enum(['verve', 'visa', 'mastercard']);
export type PaystackBankOfferCardBrand = z.infer<typeof cardBrand>;

const nonEmpty = z.string().trim().min(1);
const dateTime = z.iso.datetime({ offset: true });
const kobo = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const bankCardOfferSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    merchantId: z.uuid(),
    bankCode: z.enum(['035', '232']),
    displayName: nonEmpty,
    verifiedIssuerName: nonEmpty,
    cardBrands: z.array(cardBrand).min(1).max(3),
    eligibleProductIds: z.array(z.uuid()).min(1),
    discountBasisPoints: z.number().int().min(1).max(10_000),
    maximumDiscountKobo: kobo.positive(),
    startsAt: dateTime,
    endsAt: dateTime,
    approvedTermsReference: nonEmpty,
    enabled: z.boolean(),
  })
  .refine((offer) => Date.parse(offer.startsAt) < Date.parse(offer.endsAt), {
    path: ['endsAt'],
    message: 'Offer end must be after its start.',
  })
  .refine(
    (offer) => new Set(offer.cardBrands).size === offer.cardBrands.length,
    {
      path: ['cardBrands'],
      message: 'Select each card brand once.',
    }
  );

export type BankCardOffer = z.infer<typeof bankCardOfferSchema>;
