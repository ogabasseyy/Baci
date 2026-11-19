import { z } from 'zod';
import { SavingsPlanFundingResponseSchema } from './customer-savings';

const selection = z.strictObject({ merchantId: z.uuid(), goalId: z.uuid() });

export const PrimarySavingsPlanFundingSchemas = {
  selection,
  request: selection.extend({
    consent: z.literal(true),
    interestAccepted: z.boolean(),
  }),
  // Existing-goal setup: the customer's explicit answer, no default.
  setupRequest: selection.extend({ interestAccepted: z.boolean() }),
  // Retrying an expired setup: the answer stored for the goal is reused, so
  // none is sent (and none can contradict it).
  setupRetryRequest: selection,
  response: SavingsPlanFundingResponseSchema.extend({
    goalId: z.uuid(),
    status: z.enum([
      'ready',
      'pending',
      'unavailable',
      'conflict',
      'not_found',
    ]),
    accounts: z
      .array(
        z.object({
          accountNumber: z.string().regex(/^\d{10}$/),
          accountName: z.string().min(1).max(200),
          bankName: z.string().min(1).max(200),
        })
      )
      .max(20)
      .optional(),
  }).refine(
    (value) => (value.status === 'ready') === Boolean(value.accounts?.length),
    'A confirmed plan account is required.'
  ),
};
