import { z } from 'zod';
import { piggyvestPeriodRecoverySchemas } from './piggyvest-period-recovery';

const selection = piggyvestPeriodRecoverySchemas.command.extend({
  goalId: z.uuid().transform((value) => value.toLowerCase()),
});
const response = piggyvestPeriodRecoverySchemas.snapshot
  .omit({ record: true, canonical: true, lifecycleEvidence: true })
  .extend({
    metadataRecorded: z.boolean(),
    kind: z.enum(['credit_eligible_paid_interest', 'record_pending_interest']),
    originalCreditKobo: z.number().int().safe().positive(),
    reversed: z.boolean(),
    evidence: z.literal('internal_ledger_only'),
  });
export const piggyvestCustomerPeriodRecoverySchemas = { selection, response };
