import { z } from 'zod';

export const oxygenEligibilityProgressSchema = z.enum([
  'bank_statement',
  'credit_score',
  'eligibility_review',
]);
export type OxygenEligibilityProgress = z.infer<
  typeof oxygenEligibilityProgressSchema
>;

export const oxygenEligibilityProgressLabels: Record<
  OxygenEligibilityProgress,
  string
> = {
  bank_statement: 'Oxygen is checking your bank statement',
  credit_score: 'Oxygen is checking your credit score',
  eligibility_review: 'Oxygen is reviewing your eligibility',
};

export const oxygenEligibilityProgressHeader = 'x-oxygen-eligibility-progress';
