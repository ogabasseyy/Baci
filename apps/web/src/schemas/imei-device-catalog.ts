import { z } from 'zod';

const images = z
  .array(
    z.union([z.string(), z.object({ url: z.string().nullable().optional() })])
  )
  .nullable()
  .transform((value) => value ?? []);
const attributes = z
  .record(z.string(), z.unknown())
  .nullable()
  .transform((value) => value ?? {});
export const imeiCatalogProductsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    brand: z.string().nullable(),
    images,
  })
);
export const imeiCatalogVariantsSchema = z.array(
  z.object({
    product_id: z.string(),
    attributes,
    images,
    primary_image: z.string().nullable().optional(),
  })
);
