/**
 * Selection + labelling helpers for the storefront "Just Launched" / newly
 * released devices carousel, shared by web and mobile so both surface the same
 * pinned launches in the same order.
 *
 * Ordering contract: pinned slugs first (in the given pin order), then the
 * remaining input in its existing order, deduped by slug. The caller is
 * responsible for supplying input that is already in the desired fallback order;
 * `effectiveLaunchPins` below handles the shared newest-created pin override.
 */

/**
 * Devices explicitly pinned to the front of the launch carousel. These slugs
 * are OgaBassey-specific catalog content; they live here (alongside the generic
 * selection logic) as the single source of truth shared by the OgaBassey web
 * storefront and the OgaBassey mobile app. The `OGABASSEY_` prefix keeps the
 * merchant scope explicit within the otherwise-generic shared package. When
 * updating this list, also bump OGABASSEY_LAUNCH_PINS_SINCE to just after the
 * catalog's newest product at the time of re-curation.
 */
export const OGABASSEY_PINNED_LAUNCH_SLUGS = [
  'iphone-duo',
  'samsung-galaxy-z-flip8',
  'samsung-galaxy-s26-fe',
  'samsung-galaxy-a08',
  'redmi-note-17-pro-max-5g',
  'iphone-18-pro-max',
  'samsung-galaxy-a27-5g',
  'xiaomi-17t-pro',
  'xiaomi-17t',
  'itel-power-80-128gb-4gb',
] as const;

/**
 * How many slides the carousel shows. Single source of truth across web
 * display, web JSON-LD prepend, and mobile display. Must stay ≤ the home
 * collection-schema product limit (8) so every visible slide is represented in
 * structured data.
 */
export const LAUNCH_CAROUSEL_LIMIT = 6;

interface ProductWithSlug {
  slug?: string | null;
}

interface SelectLaunchProductsOptions {
  /** Slugs to hoist to the front, in priority order. */
  pinned?: readonly string[];
  /** Maximum number of items to return. Omit for no cap. */
  limit?: number;
}

/**
 * Pinned-first, then input order, deduped by slug, capped at `limit`.
 * A plain `[...pinnedRows, ...windowRows]` concat is safe input — dedup keeps
 * the first occurrence of each slug. Rows without a slug are passed through but
 * deduped by object identity (so the same reference appearing in both input
 * arrays isn't emitted twice); since they can't be deep-linked, carousel
 * consumers should still filter slug-less rows out.
 */
export function selectLaunchProducts<T extends ProductWithSlug>(
  items: readonly T[],
  options: SelectLaunchProductsOptions = {}
): T[] {
  const { pinned = [], limit } = options;

  const firstBySlug = new Map<string, T>();
  for (const item of items) {
    const slug = item.slug;
    if (typeof slug === 'string' && slug.length > 0 && !firstBySlug.has(slug)) {
      firstBySlug.set(slug, item);
    }
  }

  const result: T[] = [];
  const used = new Set<string>();
  const usedSlugless = new Set<T>();

  for (const slug of pinned) {
    const item = firstBySlug.get(slug);
    if (item && !used.has(slug)) {
      result.push(item);
      used.add(slug);
    }
  }

  for (const item of items) {
    const slug = item.slug;
    if (typeof slug !== 'string' || slug.length === 0) {
      if (!usedSlugless.has(item)) {
        usedSlugless.add(item);
        result.push(item);
      }
      continue;
    }
    if (!used.has(slug)) {
      result.push(item);
      used.add(slug);
    }
  }

  return typeof limit === 'number'
    ? result.slice(0, Math.max(0, Math.trunc(limit)))
    : result;
}

/** Whether a product name signals a pre-order launch. */
export function isPreorder(name: string): boolean {
  return /pre-?order/i.test(name);
}

/** Pre-order-aware call-to-action label for a launch slide. */
export function launchCtaLabel(name: string): string {
  return isPreorder(name) ? 'Pre-order now' : 'Shop now';
}

const NON_LAUNCH_DEVICE_CATEGORY_PATTERN =
  /\b(?:batter(?:y|ies)|power[\s-]*stations?|accessor(?:y|ies)|cases?|chargers?|cables?|screen[\s-]*protectors?|watch[\s-]*straps?|adapters?)\b/i;

interface JoinedCategoryRef {
  name?: string | null;
  slug?: string | null;
}

interface DatedProduct {
  slug?: string | null;
  created_at?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: JoinedCategoryRef | readonly JoinedCategoryRef[] | null;
  product_categories?:
    | readonly ({
        categories?: JoinedCategoryRef | readonly JoinedCategoryRef[] | null;
      } | null)[]
    | null;
}

/**
 * Extracts non-empty category names and slugs from a single or array-shaped
 * joined category relation.
 */
function collectJoinedCategoryValues(
  relation: JoinedCategoryRef | readonly JoinedCategoryRef[] | null | undefined
): string[] {
  if (!relation) {
    return [];
  }
  const items = Array.isArray(relation) ? relation : [relation];
  return items.flatMap((item) =>
    [item?.name, item?.slug].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
  );
}

/**
 * Determines whether a newly created product belongs to a device category
 * eligible for automatic launch-carousel promotion.
 */
function isEligibleLaunchArrival(row: DatedProduct): boolean {
  const joinedFromProductCategories = (row.product_categories ?? []).flatMap(
    (entry) => collectJoinedCategoryValues(entry?.categories)
  );
  const categoryText = [
    row.category,
    row.category_slug,
    ...collectJoinedCategoryValues(row.categories),
    ...joinedFromProductCategories,
  ]
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    .join(' ');
  if (!categoryText) {
    return true;
  }
  return !NON_LAUNCH_DEVICE_CATEGORY_PATTERN.test(categoryText);
}

/**
 * Cutoff for the "new arrivals push pins back" model: products created strictly
 * AFTER this instant count as fresh launches added since the pins were set.
 *
 * It is pinned to just after the catalog's newest product at configuration time
 * so that — today — no existing product (e.g. recently-added laptops that happen
 * to be newer than the pinned phones) outranks the configured pins; the pins
 * lead in their chosen order. Only genuinely-new products added later push the
 * pins back. Bump this whenever the pin set is re-curated.
 */
export const OGABASSEY_LAUNCH_PINS_SINCE = '2026-10-29T00:00:00.000Z';

/**
 * Effective pin order under the "new arrivals push pins back" model.
 *
 * Any candidate product created after `pinsSince` is treated as a fresh launch
 * and hoisted ahead of the configured pins (newest-created first), so newly
 * added products lead the carousel and the configured pins drift back — and fall
 * off once pushed past the carousel limit downstream. Non-device categories
 * (batteries, power stations, cases, accessories) are excluded from auto-promotion
 * so bulk accessory/power additions never displace flagship device pins.
 */
export function effectiveLaunchPins(
  candidateRows: readonly DatedProduct[],
  configuredPins: readonly string[],
  pinsSince: string
): string[] {
  if (!pinsSince) {
    return [...configuredPins];
  }

  const configured = new Set(configuredPins);
  const seen = new Set<string>();
  const newArrivals = candidateRows
    .filter(
      (row): row is DatedProduct & { slug: string; created_at: string } =>
        typeof row.slug === 'string' &&
        row.slug.length > 0 &&
        !configured.has(row.slug) &&
        typeof row.created_at === 'string' &&
        row.created_at > pinsSince &&
        isEligibleLaunchArrival(row)
    )
    // Newest-created first; ISO 8601 timestamps sort lexically.
    .sort((a, b) =>
      a.created_at === b.created_at ? 0 : a.created_at > b.created_at ? -1 : 1
    )
    .filter((row) => {
      if (seen.has(row.slug)) {
        return false;
      }
      seen.add(row.slug);
      return true;
    })
    .map((row) => row.slug);

  return [...newArrivals, ...configuredPins];
}
