import { normalizeCategoryGraphicsValue } from '../category-page-graphics-query';

export const GAMING_LAPTOPS_CATEGORY_SLUG = 'gaming-laptops';

export const GAMING_LAPTOP_GRAPHICS_HUBS = [
  { slug: 'rtx-4060', model: '4060', label: 'RTX 4060' },
  { slug: 'rtx-4070', model: '4070', label: 'RTX 4070' },
  { slug: 'rtx-4080', model: '4080', label: 'RTX 4080' },
  { slug: 'rtx-4090', model: '4090', label: 'RTX 4090' },
  { slug: 'rtx-5060', model: '5060', label: 'RTX 5060' },
  { slug: 'rtx-5070', model: '5070', label: 'RTX 5070' },
  { slug: 'rtx-5080', model: '5080', label: 'RTX 5080' },
] as const;

export type GamingLaptopGraphicsHub =
  (typeof GAMING_LAPTOP_GRAPHICS_HUBS)[number];

export function getGamingLaptopGraphicsHub(
  slug: string
): GamingLaptopGraphicsHub | null {
  return GAMING_LAPTOP_GRAPHICS_HUBS.find((hub) => hub.slug === slug) ?? null;
}

function getBaseRtxModel(value: string): string | null {
  const match = value.match(/\brtx[\s-]?(\d{4})(?![\s(/-]*(?:ti|super)\b)/i);
  return match?.[1] ?? null;
}

export function getGraphicsOptionsForHub(
  graphicsOptions: string[],
  hub: GamingLaptopGraphicsHub
): string[] {
  return graphicsOptions.filter(
    (option) => getBaseRtxModel(option) === hub.model
  );
}

export function getAvailableGamingLaptopGraphicsHubs(
  graphicsOptions: string[]
): GamingLaptopGraphicsHub[] {
  return GAMING_LAPTOP_GRAPHICS_HUBS.filter(
    (hub) => getGraphicsOptionsForHub(graphicsOptions, hub).length > 0
  );
}

export function buildGamingLaptopGraphicsHubPath(
  categorySlug: string,
  graphicsSlug: string
): string {
  return `/${categorySlug}/graphics/${graphicsSlug}`;
}

interface HubPaginationBasePathInput {
  baseUrl: string;
  canonicalBaseUrl?: string;
  requestScopedBaseUrl: string;
}

/**
 * Whether a hub-token transition carries a selection fully covered by the
 * hub's facet set. Only then may the listing lift the untrusted-request
 * cardinality cap for it; unknown hubs, empty selections, and values outside
 * the hub set stay on the capped path.
 */
export function isTrustedHubGraphicsSelection({
  graphicsOptions,
  rawGraphics,
  trustedHubSlug,
}: {
  graphicsOptions: string[];
  rawGraphics: string | string[] | undefined;
  trustedHubSlug: string | undefined;
}): boolean {
  if (!trustedHubSlug) return false;
  const hub = getGamingLaptopGraphicsHub(trustedHubSlug);
  if (!hub) return false;
  const requested = Array.isArray(rawGraphics)
    ? rawGraphics
    : rawGraphics
      ? [rawGraphics]
      : [];
  if (requested.length === 0) return false;
  const matching = new Set(getGraphicsOptionsForHub(graphicsOptions, hub));
  return requested.every((value) =>
    matching.has(normalizeCategoryGraphicsValue(value))
  );
}

/**
 * Hub slug to mint the next transition token from. Carries a validated query
 * token forward so a second deselection keeps the over-cap selection instead
 * of truncating it; an unvalidated token falls back to the hub context.
 */
export function resolveCarriedHubSlug({
  graphicsOptions,
  hubSlug,
  rawGraphics,
  trustedHubSlug,
}: {
  graphicsOptions: string[];
  hubSlug: string | undefined;
  rawGraphics: string | string[] | undefined;
  trustedHubSlug: string | undefined;
}): string | undefined {
  if (
    trustedHubSlug &&
    isTrustedHubGraphicsSelection({
      graphicsOptions,
      rawGraphics,
      trustedHubSlug,
    })
  ) {
    return trustedHubSlug;
  }
  return hubSlug;
}

/**
 * UI pagination base for curated hub pages. Anchors the hub suffix to the
 * request-scoped store URL (which carries the merchant path prefix in
 * path-routing storefronts) rather than the canonical store URL (which may
 * not), so page 2+ never leaves the merchant storefront.
 */
export function buildHubPaginationBasePath({
  baseUrl,
  canonicalBaseUrl,
  requestScopedBaseUrl,
}: HubPaginationBasePathInput): string | undefined {
  if (!canonicalBaseUrl?.startsWith(baseUrl)) {
    return undefined;
  }

  const hubSuffix = canonicalBaseUrl.slice(baseUrl.length) || '/';
  const suffix = hubSuffix.startsWith('/') ? hubSuffix : `/${hubSuffix}`;

  try {
    const scopedPath = new URL(requestScopedBaseUrl).pathname.replace(
      /\/+$/,
      ''
    );
    return `${scopedPath}${suffix}` || '/';
  } catch {
    return suffix;
  }
}
