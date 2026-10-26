import { z } from 'zod';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { buildCategoryPriceBandCandidates } from '@/lib/storefront-compare/build-commercial-support-links';

export const eligibleHubItemSchema = z
  .object({
    href: z.string().min(1),
    label: z.string().min(1),
    category_slug: z.string().optional(),
    brand_key: z.string().optional(),
    family_key: z.string().optional(),
    band_slug: z.string().optional(),
    product_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const eligibleHubDestinationsManifestSchema = z.object({
  schema_version: z.literal(1),
  taxonomy_version: z.string().min(1),
  merchant_id: z.string().uuid(),
  merchant_slug: z.string().min(1),
  canonical_host: z.string().url(),
  generated_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  destinations: z.object({
    brand_hubs: z.array(eligibleHubItemSchema),
    family_hubs: z.array(eligibleHubItemSchema),
    compare_hubs: z.array(eligibleHubItemSchema),
    price_band_hubs: z.array(eligibleHubItemSchema),
  }),
});

export type EligibleHubItem = z.infer<typeof eligibleHubItemSchema>;
export type EligibleHubDestinationsManifest = z.infer<
  typeof eligibleHubDestinationsManifestSchema
>;

export const DEFAULT_TAXONOMY_VERSION = '2026-10-25';
export const DEFAULT_MANIFEST_TTL_SECONDS = 86400;

export interface EligibleHubProductInput {
  name: string;
  slug?: string;
  brand?: string | null;
  stock?: number | null;
  price?: number;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

export interface ResolveEligibleCategoryHubDestinationsInput {
  storeUrl?: string;
  categorySlug: string;
  products: EligibleHubProductInput[];
}

export interface ResolvedEligibleCategoryHubDestinations {
  brandHubs: EligibleHubItem[];
  familyHubs: EligibleHubItem[];
  compareHubs: EligibleHubItem[];
  priceBandHubs: EligibleHubItem[];
  brand_hubs: EligibleHubItem[];
  family_hubs: EligibleHubItem[];
  compare_hubs: EligibleHubItem[];
  price_band_hubs: EligibleHubItem[];
}

export function resolveEligibleCategoryHubDestinations(
  input: ResolveEligibleCategoryHubDestinationsInput
): ResolvedEligibleCategoryHubDestinations {
  const baseUrl = input.storeUrl ? input.storeUrl.replace(/\/+$/, '') : '';
  const categorySlug = input.categorySlug;

  const availableProducts = input.products.filter(
    (product) => product.stock == null || product.stock > 0
  );

  const eligibleBrandEntries = brandAuthorityTaxonomy.getEligibleEntries(
    categorySlug,
    availableProducts
  );

  const brandHubs: EligibleHubItem[] = [];
  const familyHubs: EligibleHubItem[] = [];

  for (const brandEntry of eligibleBrandEntries) {
    brandHubs.push({
      href: `${baseUrl}/${categorySlug}/brands/${brandEntry.brandKey}`,
      label: `Explore ${brandEntry.displayName}`,
      category_slug: categorySlug,
      brand_key: brandEntry.brandKey,
      product_count: brandEntry.productCount,
    });

    const familyEntries = modelFamilyAuthorityTaxonomy.getEntries(
      categorySlug,
      brandEntry.brandKey
    );

    const brandProducts = availableProducts.filter((product) =>
      brandAuthorityTaxonomy.matchesBrand(brandEntry, product.brand ?? null)
    );

    for (const familyEntry of familyEntries) {
      const matchingProducts = brandProducts.filter((product) =>
        modelFamilyAuthorityTaxonomy.matchesProduct(familyEntry, product.name)
      );

      if (matchingProducts.length >= familyEntry.minimumProducts) {
        familyHubs.push({
          href: `${baseUrl}/${categorySlug}/brands/${brandEntry.brandKey}/families/${familyEntry.familyKey}`,
          label: `Explore ${familyEntry.displayName}`,
          category_slug: categorySlug,
          brand_key: brandEntry.brandKey,
          family_key: familyEntry.familyKey,
          product_count: matchingProducts.length,
        });
      }
    }
  }

  const compareHubs: EligibleHubItem[] = [];
  const priceBandHubs: EligibleHubItem[] = [];

  const eligiblePriceBands = buildCategoryPriceBandCandidates(
    categorySlug,
    availableProducts.map((p) => ({
      slug: p.slug ?? '',
      name: p.name,
      brand: p.brand,
      price: p.price ?? 0,
      category_slug: p.category_slug ?? categorySlug,
      product_key_specs: p.product_key_specs ?? null,
    }))
  ).filter((candidate) => candidate.isIndexable);

  for (const candidate of eligiblePriceBands) {
    priceBandHubs.push({
      href: `${baseUrl}/${categorySlug}/best-under/${candidate.band.slug}`,
      label: candidate.band.label,
      category_slug: categorySlug,
      band_slug: candidate.band.slug,
    });
  }

  return {
    brandHubs,
    familyHubs,
    compareHubs,
    priceBandHubs,
    brand_hubs: brandHubs,
    family_hubs: familyHubs,
    compare_hubs: compareHubs,
    price_band_hubs: priceBandHubs,
  };
}

export interface BuildEligibleHubDestinationsManifestInput {
  merchantId: string;
  merchantSlug: string;
  canonicalHost: string;
  taxonomyVersion?: string;
  generatedAt?: string | Date;
  expiresAt?: string | Date;
  ttlSeconds?: number;
  destinations?: {
    brand_hubs?: EligibleHubItem[];
    family_hubs?: EligibleHubItem[];
    compare_hubs?: EligibleHubItem[];
    price_band_hubs?: EligibleHubItem[];
  };
}

export function buildEligibleHubDestinationsManifest(
  input: BuildEligibleHubDestinationsManifestInput
): EligibleHubDestinationsManifest {
  const generatedDate = input.generatedAt
    ? typeof input.generatedAt === 'string'
      ? new Date(input.generatedAt)
      : input.generatedAt
    : new Date();

  const ttlSeconds = input.ttlSeconds ?? DEFAULT_MANIFEST_TTL_SECONDS;
  const expiresDate = input.expiresAt
    ? typeof input.expiresAt === 'string'
      ? new Date(input.expiresAt)
      : input.expiresAt
    : new Date(generatedDate.getTime() + ttlSeconds * 1000);

  const manifest: EligibleHubDestinationsManifest = {
    schema_version: 1,
    taxonomy_version: input.taxonomyVersion ?? DEFAULT_TAXONOMY_VERSION,
    merchant_id: input.merchantId,
    merchant_slug: input.merchantSlug,
    canonical_host: input.canonicalHost,
    generated_at: generatedDate.toISOString(),
    expires_at: expiresDate.toISOString(),
    destinations: {
      brand_hubs: input.destinations?.brand_hubs ?? [],
      family_hubs: input.destinations?.family_hubs ?? [],
      compare_hubs: input.destinations?.compare_hubs ?? [],
      price_band_hubs: input.destinations?.price_band_hubs ?? [],
    },
  };

  return eligibleHubDestinationsManifestSchema.parse(manifest);
}

function normalizePath(rawHref: string): string {
  try {
    if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      return new URL(rawHref).pathname.replace(/\/+$/, '') || '/';
    }
  } catch {
    // Treat as relative path
  }
  return rawHref.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
}

export function validateEligibleDestinationHref(
  manifest: unknown,
  href: string,
  now: Date | string | number = new Date()
): boolean {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !href ||
    typeof href !== 'string'
  ) {
    return false;
  }

  const parsed = eligibleHubDestinationsManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return false;
  }

  const nowDate =
    typeof now === 'number'
      ? new Date(now)
      : typeof now === 'string'
        ? new Date(now)
        : now;

  if (Number.isNaN(nowDate.getTime())) {
    return false;
  }

  const expiresDate = new Date(parsed.data.expires_at);
  if (nowDate.getTime() > expiresDate.getTime()) {
    return false;
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      const targetOrigin = new URL(href).origin.toLowerCase();
      const canonicalOrigin = new URL(
        parsed.data.canonical_host
      ).origin.toLowerCase();
      if (targetOrigin !== canonicalOrigin) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const targetNormalized = normalizePath(href);
  const allDestinations = [
    ...parsed.data.destinations.brand_hubs,
    ...parsed.data.destinations.family_hubs,
    ...parsed.data.destinations.compare_hubs,
    ...parsed.data.destinations.price_band_hubs,
  ];

  return allDestinations.some(
    (destination) =>
      destination.href === href ||
      normalizePath(destination.href) === targetNormalized
  );
}
