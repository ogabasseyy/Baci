import { z } from 'zod';

// Oxygen confirmed these amounts are naira, not kobo. Values are provider supplied.
const nairaAmount = z
  .number()
  .finite()
  .positive()
  .max(Number.MAX_SAFE_INTEGER / 100);
// Eligibility remains separate from booking and loan approval.
export const oxygenEligibilityReportSchema = z.object({
  loan_request_reference: z.string().min(1).max(200),
  partner_reference: z.string().min(1).max(200),
  is_eligible: z.boolean(),
  status: z.string().min(1).max(100),
  message: z.string(),
  eligible: z.never().optional(),
  successful: z.never().optional(),
  eligible_amount: nairaAmount.optional(),
  max_loan_amount: nairaAmount.optional(),
  minimum_loan_amount: nairaAmount.optional(),
  max_tenure: z.number().int().positive().optional(),
  response_code: z.never().optional(),
  error: z.never().optional(),
  errors: z.null().optional(),
});
