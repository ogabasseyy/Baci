import { z } from 'zod';
import { piggyvestProviderIdSchema } from '../piggyvest-provider-id';

const fractionalKoboSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const interestAccruedSuccessDataSchema = z.strictObject({
  id: piggyvestProviderIdSchema,
  wallet_id: z.uuid(),
  balance: fractionalKoboSchema,
  percentage: z.number().finite().min(0).max(100),
  interest_date: z.iso.datetime().max(64),
  amount: fractionalKoboSchema,
  interest_type: z.enum(['original', 'differential']),
});

export const interestAccruedSuccessEventSchema = z
  .strictObject({
    eventId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    customer_id: piggyvestProviderIdSchema.and(z.union([z.ulid(), z.uuid()])),
    eventType: z.literal('interest-accrued.success'),
    eventCategory: z.literal('interest_accrued'),
    eventData: interestAccruedSuccessDataSchema,
    pvb_wallet: z.ulid(),
    pvb_wallet_name: z.string().max(512),
    pvb_split_interest_with_wallet: z.ulid().nullable(),
    pvb_split_interest_with_wallet_name: z.string().max(512).nullable(),
  })
  .refine(
    (event) =>
      (event.pvb_split_interest_with_wallet === null) ===
      (event.pvb_split_interest_with_wallet_name === null),
    {
      message: 'Split wallet and name must both be null or both be present',
      path: ['pvb_split_interest_with_wallet_name'],
    }
  );

export type InterestAccruedSuccessEvent = z.infer<
  typeof interestAccruedSuccessEventSchema
>;
