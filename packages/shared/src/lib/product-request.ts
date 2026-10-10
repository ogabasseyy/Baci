import { z } from 'zod';
export const productRequestSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine((value) => /[\p{L}\p{N}]/u.test(value), 'Enter a product name.'),
    contact: z
      .string()
      .trim()
      .min(5)
      .max(160)
      .refine(
        (value) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
          (/^\+?[\d ()-]{7,25}$/.test(value) &&
            value.replace(/\D/g, '').length >= 7),
        'Enter an email address or phone number.'
      ),
    requestId: z.string().uuid(),
    merchantSlug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
  })
  .strict();
export type ProductRequest = z.infer<typeof productRequestSchema>;
