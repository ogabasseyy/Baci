import { z } from 'zod';

export const addressBudgetRequestSchema = z
  .object({
    provider: z.enum(['google', 'geoapify']),
    kind: z.enum(['autocomplete', 'details']),
    apiKey: z
      .string()
      .min(1)
      .max(4096)
      .refine((key) => key === key.trim()),
    reservationId: z.uuid(),
  })
  .refine(
    (request) =>
      request.provider !== 'geoapify' || request.kind === 'autocomplete'
  );
export type AddressBudgetRequest = z.infer<typeof addressBudgetRequestSchema>;
