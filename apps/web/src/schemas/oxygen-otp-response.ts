import { z } from 'zod';

const acknowledgment = z.literal('OTP retriggered for validation');
/** Oxygen staging has returned both spellings. Neither implies SMS delivery. */
export const oxygenOtpResendResponseSchema = z
  .object({
    message: acknowledgment.optional(),
    Message: acknowledgment.optional(),
  })
  .refine(
    (value) => value.message !== undefined || value.Message !== undefined
  );
