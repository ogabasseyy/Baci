import { z } from 'zod';

const crossRemCondition = z.enum([
  'new',
  'used',
  'uk_used',
  'open_box',
  'refurbished',
]);

const crossRemListingBindingSchema = z
  .strictObject({
    listingId: z.string().trim().min(1),
    productId: z.uuid(),
    variantId: z.uuid().optional(),
    offerId: z.uuid().optional(),
    condition: crossRemCondition,
    retired: z.literal(true).optional(),
    brandFallback: z.string().trim().min(1).optional(),
    assumeNewWhenMissing: z.literal(true).optional(),
  })
  .refine((binding) => !(binding.variantId && binding.offerId))
  .refine(
    (binding) =>
      !binding.assumeNewWhenMissing ||
      (binding.condition === 'new' && !binding.variantId && !binding.offerId)
  );

export const crossRemListingBindingsSchema = z.array(
  crossRemListingBindingSchema
);

export type CrossRemListingBinding = z.infer<
  typeof crossRemListingBindingSchema
>;
