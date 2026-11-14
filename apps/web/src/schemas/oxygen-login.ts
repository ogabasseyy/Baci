import { z } from 'zod';

// Login-response recogniser for the documented partner login (CR-02 sample).
// Unknown fields are stripped: extras (including any amount-ish ones) are
// ignored and must never surface as money.
export const oxygenLoginResponseSchema = z.object({
  token: z.string().min(1),
  expires_in: z.number().int().min(1).max(86_400),
});

export type OxygenLoginResponse = z.infer<typeof oxygenLoginResponseSchema>;
