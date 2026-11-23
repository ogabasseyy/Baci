import { z } from 'zod';
import { chatwootProductSlugSchema } from './chatwoot-product-slug';
import { postgresUuidSchema } from './postgres-uuid';

const productSlug = chatwootProductSlugSchema;
const availability = z.enum(['in_stock', 'out_of_stock']);
const productCondition = z.enum(['new', 'used', 'open_box']);

const productImage = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = URL.parse(value);
    return url?.protocol === 'https:' && !url.username && !url.password;
  });

export const chatwootProductCardSchema = z
  .object({
    availability,
    condition: productCondition.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    image: productImage.optional(),
    name: z.string().min(1).max(120),
    price: z.number().finite().nonnegative(),
    slug: productSlug,
    variants: z
      .array(
        z
          .object({
            attributes: z.record(z.string().max(40), z.string().max(80)),
            availability,
            condition: productCondition.optional(),
            id: postgresUuidSchema,
            image: productImage.optional(),
            price: z.number().finite().nonnegative(),
          })
          .strict()
      )
      .max(128),
  })
  .strict();

export type ChatwootProductCard = z.infer<typeof chatwootProductCardSchema>;
