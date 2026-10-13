import { z } from 'zod';

const merchantSlugTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, 'Invalid merchant slug')
  .transform((value) => value.toLowerCase());

const merchantSlugListSchema = z.array(z.string()).transform((values, ctx) => {
  const slugs: string[] = [];

  for (const rawValue of values) {
    for (const rawToken of rawValue.split(',')) {
      const parsed = merchantSlugTokenSchema.safeParse(rawToken);
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid merchant slug',
        });
        return z.NEVER;
      }

      if (!slugs.includes(parsed.data)) {
        slugs.push(parsed.data);
      }
    }
  }

  return slugs;
});

export const agenticCommerceHealthCronQuerySchema = z.object({
  fail_on_attention: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  merchant_slug: merchantSlugListSchema.default([]),
});

export type AgenticCommerceHealthCronQuery = z.infer<
  typeof agenticCommerceHealthCronQuerySchema
>;
