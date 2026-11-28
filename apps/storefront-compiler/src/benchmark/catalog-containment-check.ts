import { z } from 'zod';

const PRIVATE_CATALOG_TOKEN_RE =
  /cost_?price|supplier_?internal|stock_?qty|sup-lagos-/i;

const publicVariantSchema = z.strictObject({
  id: z.string(),
  sku: z.string().optional(),
  label: z.string(),
  storage: z.string().optional(),
  color: z.string().optional(),
  priceNgn: z.number(),
  price: z.number().optional(),
  inStock: z.boolean(),
  available: z.boolean().optional(),
});

const publicProductSchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  sku: z.string().optional(),
  name: z.string(),
  categorySlug: z.string(),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
  brand: z.string(),
  condition: z.string(),
  priceNgn: z.number(),
  price: z.number().optional(),
  currency: z.string().optional(),
  inStock: z.boolean(),
  available: z.boolean().optional(),
  requiresVariant: z.boolean().optional(),
  has_variants: z.boolean().optional(),
  imageUrl: z.string(),
  imageAlt: z.string(),
  image: z
    .strictObject({
      assetId: z.string(),
      alt: z.string(),
    })
    .optional(),
  shortSpecs: z.string(),
  canonicalPath: z.string().optional(),
  variants: z.array(publicVariantSchema),
});

const publicFacetsSchema = z.strictObject({
  brands: z.array(z.strictObject({ value: z.string(), count: z.number() })),
  conditions: z.array(z.strictObject({ value: z.string(), count: z.number() })),
  totalMatches: z.number(),
});

const outboundSearchPayloadSchema = z.strictObject({
  merchantId: z.string(),
  generation: z.number(),
  availabilityGeneration: z.number(),
  title: z.string(),
  categoryExists: z.boolean(),
  products: z.array(publicProductSchema),
  facets: publicFacetsSchema,
});

const outboundProductPayloadSchema = z.strictObject({
  merchantId: z.string(),
  generation: z.number(),
  availabilityGeneration: z.number(),
  product: publicProductSchema.nullable(),
});

const ssrStorefrontStateSchema = z.strictObject({
  view: z.string(),
  pathname: z.string(),
  workerOrigin: z.string(),
  merchantSlug: z.string(),
  title: z.string(),
  products: z.array(publicProductSchema),
  facets: publicFacetsSchema,
  productDetail: publicProductSchema.nullable(),
  publicDataRevision: z.string(),
});

export function isContainedPublicCatalogJson(bodyText: string): boolean {
  if (PRIVATE_CATALOG_TOKEN_RE.test(bodyText)) return false;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return (
      outboundSearchPayloadSchema.safeParse(parsed).success ||
      outboundProductPayloadSchema.safeParse(parsed).success
    );
  } catch {
    return false;
  }
}

export function isContainedStorefrontHtml(
  html: string,
  status: number
): boolean {
  if (PRIVATE_CATALOG_TOKEN_RE.test(html)) return false;
  const match =
    /<script id="__BACI_STOREFRONT_STATE__" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html
    );
  if (!match) return status >= 500;
  try {
    const parsed: unknown = JSON.parse(match[1] ?? '');
    return ssrStorefrontStateSchema.safeParse(parsed).success;
  } catch {
    return false;
  }
}
