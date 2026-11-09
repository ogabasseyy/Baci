import type { Route as NextRoute } from 'next';

/** Narrowed Next.js Route alias (`Route<never>`) to avoid TS2589 union distribution on `<Link>`. */
export type DynamicRoute = NextRoute<never>;
type Route = DynamicRoute;

/**
 * Type-safe route builders for dynamic routes (`typedRoutes: true`).
 */
export const routes = {
  // Storefront Routes (public merchant store pages)

  /** Merchant storefront homepage: /{slug} */
  storefront: (slug: string) => `/${slug}` as Route,

  /** Category page: /{slug}/{category} */
  category: (slug: string, category: string) => `/${slug}/${category}` as Route,

  /** Product detail via /products path: /{slug}/products/{productSlug} */
  product: (slug: string, productSlug: string) =>
    `/${slug}/products/${productSlug}` as Route,

  /** Product detail via category path: /{slug}/{category}/{productSlug} */
  categoryProduct: (slug: string, category: string, productSlug: string) =>
    `/${slug}/${category}/${productSlug}` as Route,

  /** Search page: /{slug}/search?q={query} */
  search: (slug: string, query?: string): Route => {
    const basePath: string = `/${slug}/search`;
    if (!query) return asRoute(basePath);
    const queryPath: string = `${basePath}?q=${encodeURIComponent(query)}`;
    return asRoute(queryPath);
  },

  /** Cart page: /{slug}/cart */
  cart: (slug: string) => `/${slug}/cart` as Route,

  /** Repair Booking: /{slug}/repair */
  storefrontRepair: (slug: string) => `/${slug}/repair` as Route,

  /** Repairs catalogue landing: /{slug}/repairs */
  storefrontRepairs: (slug: string) => `/${slug}/repairs` as Route,

  /** Repairs device detail: /{slug}/repairs/{deviceSlug} */
  storefrontRepairDevice: (slug: string, deviceSlug: string) =>
    `/${slug}/repairs/${deviceSlug}` as Route,

  // ============================================================
  // Dashboard Routes (authenticated merchant admin)
  // ============================================================

  /** Dashboard home */
  dashboard: '/dashboard' as Route,

  /** Products list */
  dashboardProducts: '/dashboard/products' as Route,

  /** Single product edit */
  dashboardProduct: (productId: string) =>
    `/dashboard/products/${productId}` as Route,

  /** New product */
  dashboardNewProduct: '/dashboard/products/new' as Route,

  /** Orders list */
  dashboardOrders: '/dashboard/orders' as Route,

  /** Single order */
  dashboardOrder: (orderId: string) => `/dashboard/orders/${orderId}` as Route,

  /** Customers list */
  dashboardCustomers: '/dashboard/customers' as Route,

  /** Single customer */
  dashboardCustomer: (customerId: string) =>
    `/dashboard/customers/${customerId}` as Route,

  /** Analytics */
  dashboardAnalytics: '/dashboard/analytics' as Route,

  /** Settings */
  dashboardSettings: '/dashboard/settings' as Route,

  /** Marketing hub */
  dashboardMarketing: '/dashboard/marketing' as Route,

  /** Marketing / Discount codes */
  dashboardDiscountCodes: '/dashboard/marketing/discount-codes' as Route,

  /** Domains */
  dashboardDomains: '/dashboard/domains' as Route,

  /** Single domain */
  dashboardDomain: (domain: string) => `/dashboard/domains/${domain}` as Route,

  /** Reviews moderation */
  dashboardReviews: '/dashboard/reviews' as Route,

  /** Integrations */
  dashboardIntegrations: '/dashboard/integrations' as Route,

  /** Pages (Puck builder pages) */
  dashboardPages: '/dashboard/pages' as Route,

  /** Notifications */
  dashboardNotifications: '/dashboard/notifications' as Route,

  // ============================================================
  // Builder Routes (Puck page builder)
  // ============================================================

  /** Builder home (edit current page) */
  builder: '/builder' as Route,

  /** Edit specific page */
  builderPage: (pageSlug: string) => `/builder/${pageSlug}` as Route,

  // ============================================================
  // Auth Routes
  // ============================================================

  /** Login page */
  login: '/login' as Route,

  /** Onboarding flow */
  onboarding: '/onboarding' as Route,

  /** Password reset */
  resetPassword: '/reset-password' as Route,

  /** Auth callback (OAuth) */
  authCallback: '/auth/callback' as Route,

  // ============================================================
  // Checkout Routes
  // ============================================================

  /** Checkout page */
  checkout: '/checkout' as Route,

  /** Order confirmation */
  orderConfirmation: (orderId: string) =>
    `/checkout/confirmation/${orderId}` as Route,

  // ============================================================
  // Static Routes
  // ============================================================

  /** Landing page */
  home: '/' as Route,

  /** Terms of Service */
  terms: '/terms' as Route,

  /** Privacy Policy */
  privacy: '/privacy' as Route,

  // ============================================================
  // Admin Routes (platform admin, not merchant)
  // ============================================================

  /** Admin dashboard */
  admin: '/admin' as Route,

  /** Admin settings */
  adminSettings: '/admin/settings' as Route,
} as const;

/**
 * Type for all available routes
 */
export type AppRoutes = typeof routes;

/**
 * Helper to check if a string is a valid route key
 */
export function isValidRouteKey(key: string): key is keyof AppRoutes {
  return key in routes;
}

/**
 * Cast a dynamic internal pathname to the narrowed `DynamicRoute` type.
 * Use this for internal paths that can't be statically validated at compile time;
 * use a native `<a>` element for external `https://` URLs.
 *
 * @example
 * ```tsx
 * // For dynamic internal paths from CMS or merchant storefront scoping
 * <Link href={asRoute(`/${merchantSlug}/${pageSlug}`)}>Read more</Link>
 * ```
 */
export function asRoute(url: string): Route {
  return url as unknown as Route;
}

/**
 * Normalize an optional storefront route base path.
 *
 * Empty and root inputs intentionally normalize to an empty base path so
 * custom-domain storefront links can resolve from `/` without a slug prefix.
 */
export function normalizeRouteBasePath(basePath: string): string {
  const normalizedBasePath = basePath.trim().replace(/\/+$/, '');

  if (!normalizedBasePath) {
    return '';
  }

  return normalizedBasePath.startsWith('/')
    ? normalizedBasePath
    : `/${normalizedBasePath}`;
}

function isAbsoluteHttpUrl(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  return (
    normalizedValue.startsWith('https://') ||
    normalizedValue.startsWith('http://')
  );
}

/**
 * Join a normalized storefront base path with an internal path while preserving
 * absolute external URLs.
 */
export function joinRouteBasePath(basePath: string, path: string): string {
  if (isAbsoluteHttpUrl(path)) {
    return path;
  }

  if (isAbsoluteHttpUrl(basePath)) {
    const normalizedBaseUrl = basePath.trim().replace(/\/+$/, '');
    if (!path || path === '/') {
      return normalizedBaseUrl;
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  const routeBasePath = normalizeRouteBasePath(basePath);

  if (!path || path === '/') {
    return routeBasePath || '/';
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${routeBasePath}${normalizedPath}`;
}

/**
 * Additional route builders for less common routes
 */
export const dynamicRoutes = {
  /** Wishlist page: /{slug}/wishlist */
  wishlist: (slug: string) => `/${slug}/wishlist` as Route,

  /**
   * @deprecated Use `storefrontPage` instead to ensure correct routing for multi-tenant stores (path vs domain).
   * Static page: /pages/{pageSlug}
   */
  page: (pageSlug: string) => `/pages/${pageSlug}` as Route,

  /** Storefront static page: /{slug}/pages/{pageSlug} */
  storefrontPage: (slug: string, pageSlug: string) =>
    `/${slug}/pages/${pageSlug}` as Route,

  /** Blog post: /blog/{postSlug} */
  blogPost: (postSlug: string) => `/blog/${postSlug}` as Route,

  /** Order tracking: /track/{trackingNumber} */
  tracking: (trackingNumber: string) => `/track/${trackingNumber}` as Route,

  /** Invite acceptance: /invite/{token} */
  invite: (token: string) => `/invite/${token}` as Route,

  /** Staff management */
  dashboardStaff: '/dashboard/staff' as Route,

  /** SEO settings */
  dashboardSeo: '/dashboard/seo' as Route,

  /** Loyalty program */
  dashboardLoyalty: '/dashboard/loyalty' as Route,

  /** Checkout success */
  checkoutSuccess: '/checkout/success' as Route,
} as const;
