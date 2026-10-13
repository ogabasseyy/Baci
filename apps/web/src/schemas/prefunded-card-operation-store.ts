import { z } from 'zod';

export const prefundedCardOperationInputSchemas = {
  leaseSeconds: z.number().int().min(1).max(300),
  reconciliationLeg: z.enum(['collection', 'transfer']),
  reconciliationOutcome: z.enum(['verified_success', 'verified_failed']),
  collectionOutcome: z.enum(['unknown', 'verified_success', 'verified_failed']),
  transferOutcome: z.enum(['unknown', 'verified_success']),
  evidence: z.record(z.string(), z.unknown()),
};
