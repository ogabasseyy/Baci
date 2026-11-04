import type { ExperienceManifest } from '@baci/shared/experience';
import { storefrontRouteSegments } from '@/config/storefront-route-segments';
export const RESERVED_EXPERIENCE_PAGES = new Set([
  'about',
  'contact',
  'faq',
  'privacy',
  'terms',
  'rewards',
  'blog',
]);
type Route = ExperienceManifest['routes'][number];
export function normalizeExperiencePath(path: string): string {
  if (
    path.length > 1024 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[?#\\]/.test(path) ||
    Array.from(path).some((c) => c.charCodeAt(0) <= 32) ||
    /%(?:2f|5c|25)/i.test(path)
  )
    throw Error('INVALID_ROUTE');
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw Error('INVALID_ROUTE');
  }
  if (!/^\/[a-zA-Z0-9_/[\]-]*$/.test(decoded)) throw Error('INVALID_ROUTE');
  if (
    decoded
      .split('/')
      .slice(1)
      .some((p) => p === '.' || p === '..' || p === '') &&
    decoded !== '/'
  )
    throw Error('INVALID_ROUTE');
  return decoded;
}
export function validateExperienceRoutes(routes: Route[]): Route[] {
  if (routes.length > 64) throw Error('ROUTE_QUOTA');
  const seen = new Set<string>();
  return routes.map((route) => {
    const path = normalizeExperiencePath(route.path);
    const legal =
      (path === '/' && route.view === 'home') ||
      (path === '/collections/[handle]' && route.view === 'collection') ||
      (path === '/products/[handle]' && route.view === 'product') ||
      (path.startsWith('/pages/') && route.view === 'editorial');
    if (
      !legal ||
      path.startsWith('/pages/[') ||
      RESERVED_EXPERIENCE_PAGES.has(path.split('/')[2]?.toLowerCase())
    )
      throw Error('RESERVED_NATIVE_ROUTE');
    const key = path.replace(/\[[^/]+\]/g, '[]');
    if (seen.has(key)) throw Error('DUPLICATE_ROUTE');
    seen.add(key);
    return { ...route, path };
  });
}
export function resolveExperienceRoute(
  routes: Route[],
  path: string
): {
  view: Route['view'];
  params: Record<string, string>;
  canonicalPath: string;
} | null {
  let safe: string;
  try {
    safe = normalizeExperiencePath(path);
  } catch {
    return null;
  }
  const parts = safe.split('/');
  for (const route of validateExperienceRoutes(routes)) {
    const pattern = route.path.split('/');
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, index) => {
      if (/^\[[a-zA-Z][\w]*\]$/.test(part)) {
        if (!parts[index]) return false;
        params[part.slice(1, -1)] = parts[index];
        return true;
      }
      return part === parts[index];
    });
    if (matches) return { view: route.view, params, canonicalPath: safe };
  }
  return null;
}

export function isCategorizedExperienceProductPath(path: string) {
  const [, family, handle] = path.split('/');
  return (
    /^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(path) &&
    !storefrontRouteSegments.STOREFRONT_ROUTE_FIRST_SEGMENTS.has(family) &&
    !storefrontRouteSegments.CUSTOM_DOMAIN_APP_ROUTE_FIRST_SEGMENTS.has(
      family
    ) &&
    // Category compare hubs are native pages, not a product named "compare".
    handle !== 'compare'
  );
}
