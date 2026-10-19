import { z } from 'zod';

export const StorefrontCsrfTokenSchema = z.object({
  token: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\r\n]+$/),
});
