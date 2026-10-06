import { z } from 'zod';

const koboSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const deviceSchema = z
  .object({
    productId: z.string().min(1),
    variantId: z.string().min(1).nullable(),
    condition: z.string().min(1),
  })
  .strict();

const quotedPriceSchema = z
  .object({
    version: z.string().min(1),
    device: deviceSchema,
    priceKobo: koboSchema.positive(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const piggyvestSavingsPolicyInputSchema = z
  .object({
    policyVersion: z.literal('2026-09-11'),
    now: z.string().datetime({ offset: true }),
    goalState: z.enum([
      'draft',
      'active',
      'ready',
      'purchase_pending',
      'purchased',
      'cancellation_pending',
      'cancelled',
    ]),
    requestedAction: z.enum([
      'none',
      'activate',
      'checkout',
      'cancel',
      'device_change',
    ]),
    collectionPaused: z.boolean(),
    hasBeforeFundingConsent: z.boolean(),
    cancellationInterestForfeitureConsentVersion: z.literal('2026-09-11'),
    device: deviceSchema,
    ledger: z
      .object({
        confirmedPrincipalKobo: koboSchema,
        reservedPrincipalKobo: koboSchema,
        paidEligibleInterestKobo: koboSchema,
        reservedPaidInterestKobo: koboSchema,
        pendingInterestKobo: koboSchema,
      })
      .strict()
      .superRefine((ledger, context) => {
        if (ledger.reservedPrincipalKobo > ledger.confirmedPrincipalKobo) {
          context.addIssue({
            code: 'custom',
            message: 'Reserved principal exceeds confirmed principal',
          });
        }
        if (ledger.reservedPaidInterestKobo > ledger.paidEligibleInterestKobo) {
          context.addIssue({
            code: 'custom',
            message: 'Reserved interest exceeds paid interest',
          });
        }
      }),
    activationQuote: quotedPriceSchema.nullable(),
    currentOffer: z
      .object({ device: deviceSchema, priceKobo: koboSchema.positive() })
      .strict(),
    guarantee: quotedPriceSchema.nullable(),
    protectedOffer: quotedPriceSchema.nullable().optional(),
    maturityGraceExpiresAt: z.string().datetime({ offset: true }).optional(),
    fundingReversed: z.boolean().optional().default(false),
    reservation: z.enum(['none', 'purchase', 'cancellation', 'device_change']),
  })
  .strict()
  .superRefine((input, context) => {
    const hasReservedFunds =
      input.ledger.reservedPrincipalKobo > 0 ||
      input.ledger.reservedPaidInterestKobo > 0;
    const hasPendingStateReservation =
      input.goalState === 'purchase_pending' ||
      input.goalState === 'cancellation_pending';
    if (
      hasReservedFunds &&
      input.reservation === 'none' &&
      !hasPendingStateReservation
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Reserved funds require an operation reservation or pending goal state',
      });
    }
  });

export type PiggyvestSavingsPolicyInput = z.infer<
  typeof piggyvestSavingsPolicyInputSchema
>;
