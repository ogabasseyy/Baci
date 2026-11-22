import { z } from 'zod';

// Preserve fields from both the outer dispute and the nested transaction.
export const paystackDisputeObjectSchema = z.record(z.string(), z.unknown());
