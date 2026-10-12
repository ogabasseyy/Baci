import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import { z } from 'zod';

const origin = z
  .string()
  .regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/)
  .refine((value) => Number(value.split(':').at(-1)) <= 65535);
export const runtimeJourneyBrowserSchemas = {
  origin,
  scenario: z
    .strictObject({
      goalId: z.uuid(),
      label: z.string().min(1).max(100),
      pathPrefix: z.string().regex(/^\/scenario\/[0-9]{3}$/),
      operationId: z.uuid().optional(),
      purchaseSelection: piggyvestPurchaseSchemas.selection.optional(),
    })
    .refine(
      (scenario) =>
        !scenario.purchaseSelection ||
        (scenario.purchaseSelection.goalId === scenario.goalId &&
          Boolean(scenario.operationId))
    ),
  csrf: z.strictObject({
    csrfToken: z.string().regex(/^[\x21-\x7e]{1,512}$/),
    expiresAt: z.number().int().safe().positive(),
  }),
  capability: z.strictObject({
    mode: z.enum(['prepare', 'recovery']),
    goalId: z.uuid(),
    operationId: z.uuid(),
  }),
};
