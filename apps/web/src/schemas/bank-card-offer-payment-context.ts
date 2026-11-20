import { z } from 'zod';

const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const savedQuote = z.object({
  merchantId: z.uuid(),
  approvedTermsReference: z.string().min(1),
  endsAt: z.iso.datetime({ offset: true }),
  paymentPolicy: z.object({
    partnership: z.string().min(1),
    bankCode: z.enum(['035', '232']),
    issuerName: z.string().min(1),
    cardBrands: z
      .array(z.enum(['visa', 'mastercard', 'verve']))
      .min(1)
      .max(3),
  }),
  productSubtotalKobo: positiveSafeInteger,
  eligibleSubtotalKobo: positiveSafeInteger,
  discountKobo: positiveSafeInteger,
  allocations: z
    .array(
      z.object({
        itemId: z.uuid(),
        productId: z.uuid(),
        quantity: positiveSafeInteger,
        unitPriceKobo: z.number().int().nonnegative(),
        unitNetAmountsKobo: z.array(z.number().int().nonnegative()),
      })
    )
    .min(1),
});

export const bankCardOfferPaymentContextSchema = z.object({
  quote: savedQuote,
  amountKobo: positiveSafeInteger,
  customerEmail: z.email(),
});
