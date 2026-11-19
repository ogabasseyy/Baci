import { z } from 'zod';

// Sample recognisers only; not a complete or verified provider response contract.
// Accept unrelated added fields, but never strip conflicting decision/error fields.
export const oxygenAffirmativeEligibilitySchema = z.object({
  message: z.never().optional(),
  successful: z.literal(true),
  eligible: z.literal(true),
  eligible_amount: z.number().finite().positive(),
  status: z.literal(200).optional(),
  response_code: z.never().optional(),
  error: z.never().optional(),
  errors: z.null().optional(),
});

export const oxygenPendingEligibilitySchema = z.object({
  response: z.never().optional(),
  status: z.literal(400),
  response_code: z.literal('99'),
  successful: z.never().optional(),
  eligible: z.never().optional(),
  eligible_amount: z.never().optional(),
  errors: z.null().optional(),
  error: z.literal('Bad Request').optional(),
});
