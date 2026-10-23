import * as z from 'zod/mini';

// Mirrors the ogabassey Product condition union
// (apps/web/src/components/storefront/ogabassey/types.ts). Unknown stored
// values drop to undefined so the item survives hydration and the tray
// falls back to "Condition not refreshed".
const snapshotCondition = z.catch(
  z.optional(
    z.enum([
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
  ),
  undefined
);

// Persist only validated fallback fields; refreshed catalog data supplies current facts.
export const comparisonSnapshotSchema = z.object({
  id: z.union([z.string().check(z.trim(), z.minLength(1)), z.number()]),
  name: z.string().check(z.trim(), z.minLength(1)),
  price: z.string(),
  image: z.string(),
  description: z.string(),
  brand: z.optional(z.string()),
  condition: snapshotCondition,
  slug: z.optional(z.string()),
  merchantId: z.optional(z.string()),
  rawPrice: z.optional(z.number().check(z.gte(0))),
  category: z.optional(z.string()),
  categorySlug: z.optional(z.string()),
  categories: z.optional(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.optional(z.string()),
    })
  ),
  // Variant/offer ids are UUIDs; malformed persisted values drop the field
  // (keeping the parent-basis item) instead of failing downstream readers.
  matchVariantId: z.catch(z.optional(z.uuid()), undefined),
  matchOfferId: z.catch(z.optional(z.uuid()), undefined),
  // Same union as condition: writers only emit canonical values, so a
  // stale or hand-edited string drops the marker instead of flowing to
  // tray/PDP basis labels.
  matchCondition: snapshotCondition,
});
