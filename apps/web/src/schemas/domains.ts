import { z } from 'zod';

const domainRegex =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/i;

export const createDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(253)
    .refine((value) => domainRegex.test(value), {
      error: 'Invalid domain format',
    }),
  isPrimary: z.boolean().optional(),
});

export type CreateDomainInput = z.infer<typeof createDomainSchema>;
