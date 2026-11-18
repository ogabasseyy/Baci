/**
 * Speculation Rules builder for the OgaBassey-template storefront (SPEC-RULES).
 *
 * Emits document rules that let Chromium prerender the highest-value next
 * navigation (listing/home -> PDP) and cheaply prefetch the broader set
 * (home/PDP -> category listing). Rules are consumed by
 * `StorefrontSpeculationRules`, which serializes this object into an inline
 * `<script type="speculationrules">`.
 *
 * Design constraints (see docs/perf/ogabassey-cwv-headroom-execution-plan.md
 * §SPEC-RULES):
 *  - PDP links use `prerender` at `moderate` eagerness (fires on ~200ms hover /
 *    pointerdown). Chromium caps eager/moderate/conservative speculation at 2
 *    concurrent entries (FIFO — a new one evicts the oldest), so the moderate
 *    hover trigger naturally bounds resource cost.
 *  - Category links use the cheaper `prefetch` (fetches HTML without executing
 *    JS) for the broader set.
 *  - NEVER speculate cart / checkout / account / wallet / wishlist / order /
 *    track-order / auth or other per-user or state-changing routes, `/api/*`,
 *    blog, or any URL carrying a query string.
 *  - `[data-no-speculation]` and `rel=nofollow` links opt out.
 *
 * URL shape (see `buildProductUrl` / navbar category links):
 *  - PDP: `${basePath}/:category/:product` (exactly two path segments)
 *  - Category listing: `${basePath}/:category` (exactly one path segment)
 * where `basePath` is '' on a custom domain (ogabassey.com) or `/${slug}` in
 * path-routing mode (usebaci.com/${slug}).
 */

/**
 * URLPattern init object accepted by `href_matches` (same fields as the DOM
 * URLPattern). Only the components we use are typed; unspecified components
 * default to a wildcard.
 */
interface SpeculationUrlPattern {
  pathname?: string;
  search?: string;
  hash?: string;
  hostname?: string;
  protocol?: string;
}

type SpeculationCondition =
  | { href_matches: string | SpeculationUrlPattern }
  | { selector_matches: string }
  | { not: SpeculationCondition }
  | { and: SpeculationCondition[] }
  | { or: SpeculationCondition[] };

type SpeculationEagerness = 'immediate' | 'eager' | 'moderate' | 'conservative';

interface SpeculationDocumentRule {
  eagerness: SpeculationEagerness;
  where: SpeculationCondition;
}

export interface StorefrontSpeculationRuleset {
  prerender: SpeculationDocumentRule[];
  prefetch: SpeculationDocumentRule[];
}

/**
 * First path segments that are NOT category listings and must never be
 * speculated: per-user, state-changing, or non-product routes. Kept in sync
 * with the storefront route map under `app/(storefront)/[slug]`.
 */
const RESERVED_STOREFRONT_SEGMENTS = [
  // Commerce / per-user / state-changing surfaces.
  'cart',
  'checkout',
  'account',
  'my-account',
  'wallet',
  'wishlist',
  'track-order',
  'order-success',
  'receipts',
  'delete-account',
  'member-status',
  'login',
  // Non-product utility / dynamic surfaces.
  'search',
  'compare',
  'products',
  'product',
  'blog',
  'imei-check',
  'repair',
  'repairs',
  'quiz',
  'reviews',
  'swap',
  'unlock-orders',
  'about',
  'contact',
  'faq',
  'pages',
  'privacy',
  'privacy-policy',
  'returns',
  'shipping',
  'terms',
  'terms-and-conditions',
  'terms-of-service',
  'warranty',
  'api',
] as const;

const PRERENDER_EAGERNESS: SpeculationEagerness = 'conservative';
const PREFETCH_EAGERNESS: SpeculationEagerness = 'moderate';

/** URLPattern alternation group of the reserved first segments. */
function reservedSegmentGroup(): string {
  return `(${RESERVED_STOREFRONT_SEGMENTS.join('|')})`;
}

/**
 * Exclusions shared by both rules: any URL carrying a query string (search /
 * filter / UTM / ad params) plus the per-link opt-out and `rel=nofollow`
 * escape hatches.
 *
 * The query-string exclusion uses the URLPattern object form `{ search: '(.+)' }`
 * — matching a non-empty search component — instead of a `*\\?*` pathname
 * string. A pathname pattern such as `/*\\?*` matches URLs with AND without a
 * query string (the escaped `?` collapses to an optional token), so negating it
 * would exclude every link and silently disable all speculation.
 */
function sharedExclusions(): SpeculationCondition[] {
  return [
    { not: { href_matches: { search: '(.+)' } } },
    { not: { selector_matches: '[data-no-speculation]' } },
    { not: { selector_matches: '[rel~=nofollow]' } },
  ];
}

export function buildStorefrontSpeculationRules(
  basePath: string
): StorefrontSpeculationRuleset {
  const reserved = reservedSegmentGroup();
  const pdpWhere: SpeculationCondition = {
    and: [
      // Exactly two path segments => a product detail page.
      { href_matches: `${basePath}/:category/:product` },
      // Drop reserved sections (e.g. /account/orders, /checkout/success,
      // /blog/:post) that also have a two-segment shape.
      { not: { href_matches: `${basePath}/${reserved}/*` } },
      // Drop the /:category/compare listing sub-route.
      { not: { href_matches: `${basePath}/*/compare` } },
      ...sharedExclusions(),
    ],
  };

  return {
    prerender: [
      {
        eagerness: PRERENDER_EAGERNESS,
        where: pdpWhere,
      },
    ],
    prefetch: [
      {
        eagerness: PREFETCH_EAGERNESS,
        where: {
          and: [
            // Exactly one path segment => a category listing. The empty home
            // path ('' / basePath) has no segment and never matches.
            { href_matches: `${basePath}/:category` },
            { not: { href_matches: `${basePath}/${reserved}` } },
            ...sharedExclusions(),
          ],
        },
      },
      {
        eagerness: PREFETCH_EAGERNESS,
        where: pdpWhere,
      },
    ],
  };
}
