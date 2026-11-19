import { z } from 'zod';
import { jumiaMerchantIdQuerySchema } from '@/schemas/marketplace';
import { JumiaBrandsResponseSchema, JumiaCategorySchema } from './catalog';

export const jumiaDestinationQuerySchema =
  jumiaMerchantIdQuerySchema.required();
export const jumiaAttributeSetParamSchema = z.object({
  attributeSetId: z.uuid(),
});
const catalogAvailabilitySchema = z.object({
  scope: z.literal('provider-wide'),
  destinationVerified: z.literal(false),
});
export const jumiaCategoryMetadataSchema = z.object({
  categories: JumiaCategorySchema.array(),
  availability: catalogAvailabilitySchema.optional(),
});
export const jumiaBrandMetadataSchema = JumiaBrandsResponseSchema.pick({
  brands: true,
}).extend({
  availability: catalogAvailabilitySchema.optional(),
});
export const jumiaDestinationContextSchema = z.object({
  businessClients: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      countryCode: z.string().min(1),
    })
  ),
});
