import { z } from 'zod';

// Mirrors the ogabassey Product condition union
// (apps/web/src/components/storefront/ogabassey/types.ts). Unknown stored
// values drop to undefined so the item survives hydration and the tray
// falls back to "Condition not refreshed".
const snapshotCondition = z
  .enum([
    'New',
    'Used',
    'Open Box',
    'New & Used',
    'New & Open Box',
    'Used & Open Box',
    'Multiple Conditions',
    'new',
    'used',
    'open_box',
    'refurbished',
  ])
  .optional()
  .catch(undefined);

// Persist only validated fallback fields; refreshed catalog data supplies current facts.
export const comparisonSnapshotSchema = z.object({
  id: z.union([z.string().trim().min(1), z.number().finite()]),
  name: z.string().trim().min(1),
  price: z.string(),
  image: z.string(),
  description: z.string(),
  brand: z.string().optional(),
  condition: snapshotCondition,
  slug: z.string().optional(),
  merchantId: z.string().optional(),
  rawPrice: z.number().finite().nonnegative().optional(),
  category: z.string().optional(),
  categorySlug: z.string().optional(),
  categories: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string().optional(),
    })
    .optional(),
  // Variant/offer ids are UUIDs; malformed persisted values drop the field
  // (keeping the parent-basis item) instead of failing downstream readers.
  matchVariantId: z.string().uuid().optional().catch(undefined),
  matchOfferId: z.string().uuid().optional().catch(undefined),
  matchCondition: z.string().optional(),
});
