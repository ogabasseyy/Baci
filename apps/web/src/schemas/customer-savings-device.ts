import { z } from 'zod';

export const SavingsDeviceVariantSchema = z.object({
  archived_at: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.string()).nullable().optional(),
  condition: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  id: z.string(),
  images: z.array(z.string()).nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  is_inventory_anchor: z.boolean().nullable().optional(),
  price_override: z.union([z.number(), z.string()]).nullable().optional(),
  primary_image: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export const SavingsDeviceProductSchema = z.object({
  condition: z.string().nullable().optional(),
  id: z.string(),
  images: z.array(z.string()).nullable().optional(),
  name: z.string(),
  price: z.union([z.number(), z.string()]),
  variants: z.array(SavingsDeviceVariantSchema).nullable().optional(),
});

export type SavingsDeviceProduct = z.infer<typeof SavingsDeviceProductSchema>;
export type SavingsDeviceVariant = z.infer<typeof SavingsDeviceVariantSchema>;
