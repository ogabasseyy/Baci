import { z } from 'zod';
import { repairsDeviceDetailRouteParamsSchema } from '@/schemas/repair-catalog';

export const repairMerchantIdSchema = z.uuid();

/** Storefront slug / hostname token used to resolve the published merchant. */
export const repairMerchantIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.toLowerCase());

/** Customer-facing pickup fee quoted before Paystack initialization. */
export const repairPickupExpectedFeeSchema = z.coerce
  .number()
  .finite()
  .positive()
  .max(10_000_000);

/**
 * `/[slug]/repair?device=<slug>&quote=<id>` preselection query params. Reuses
 * the same device-slug shape the storefront read API validates route params
 * with, so a malformed/bot-supplied slug is rejected before it ever reaches
 * the catalogue data layer.
 */
export const repairBookingSearchParamsSchema = z.object({
  device: repairsDeviceDetailRouteParamsSchema.shape.deviceSlug.optional(),
  quote: z.uuid().optional(),
});

export type RepairBookingSearchParams = z.infer<
  typeof repairBookingSearchParamsSchema
>;

const optionalPlaceText = (maxLength: number) =>
  z.string().trim().max(maxLength).optional().default('');

export const repairPlaceDetailsSchema = z
  .object({
    streetNumber: optionalPlaceText(32),
    route: optionalPlaceText(200),
    city: optionalPlaceText(120),
    state: optionalPlaceText(120),
    zip: optionalPlaceText(32),
    country: optionalPlaceText(120),
    formattedAddress: optionalPlaceText(500),
  })
  .superRefine((place, ctx) => {
    if (!place.formattedAddress || !place.city || !place.state) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a complete pickup address.',
        path: ['formattedAddress'],
      });
    }
  });

export type RepairPlaceDetails = z.output<typeof repairPlaceDetailsSchema>;
