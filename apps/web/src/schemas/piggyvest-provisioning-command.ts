import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

const boundedText = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.isWellFormed() &&
      !Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
  );
const identity = {
  merchantId: z.uuid(),
  customerId: z.uuid(),
  enableInterestAccrual: z.boolean(),
  interestPayout: z.enum(['own_wallet', 'configured_destination']),
};

export const piggyvestProvisioningCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...identity,
    kind: z.literal('create_customer'),
    bvn: z.string().regex(/^\d{11}$/),
    email: z.email().max(254),
    name: boundedText,
    phone: boundedText,
  }),
  z.strictObject({
    ...identity,
    kind: z.literal('create_plan_wallet'),
    goalId: z.uuid(),
    providerCustomerId: piggyvestProviderIdSchema,
    reserveVirtualAccount: z.boolean(),
    customerName: boundedText.optional(),
  }),
]);
