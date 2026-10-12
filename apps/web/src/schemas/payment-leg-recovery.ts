import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import { z } from 'zod';
import { purchaseCurrentRecoverySchemas } from './purchase-current-recovery';
import { purchasePreparationSchemas } from './purchase-preparation';

const uuid = z.uuid().transform((value) => value.toLowerCase());

const result = purchaseCurrentRecoverySchemas.result
  .extend({
    paymentLegRecovery: piggyvestPurchaseSchemas.paymentLegRecovery,
  })
  .superRefine((value, context) => {
    const legs = value.paymentLegRecovery.legs;
    if (
      legs[0].operationId !== value.operationId ||
      legs[0].amountKobo !== value.savingsKobo ||
      legs[1].amountKobo !== value.otherPaymentKobo
    )
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent recovery legs',
      });
  });

export const paymentLegRecoverySchemas = {
  configuration: purchasePreparationSchemas.configuration.extend({
    enabled: z.boolean().default(false),
  }),
  observation: z.strictObject({
    operationId: uuid,
    observationId: uuid.optional(),
    leg: z.enum(['savings', 'other']),
    reason: z.enum([
      'contract_unconfirmed',
      'outcome_unconfirmed',
      'compensation_unresolved',
      'reference_unverified',
    ]),
  }),
  lookup: z.strictObject({
    operationId: uuid,
    observationId: uuid.nullable().default(null),
  }),
  result,
  rows: z.array(z.strictObject({ result })).length(1),
};
