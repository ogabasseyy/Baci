import type { ExperienceManifest } from '@baci/shared/experience';
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
  for (const route of validateExperienceRoutes(routes)) {
    const names: string[] = [];
    const expression = route.path
      .split('/')
      .map((part) => {
        if (/^\[[a-zA-Z][\w]*\]$/.test(part)) {
          names.push(part.slice(1, -1));
          return '([^/]+)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const match = safe.match(new RegExp(`^${expression}$`));
    if (match)
      return {
        view: route.view,
        params: Object.fromEntries(names.map((n, i) => [n, match[i + 1]])),
        canonicalPath: safe,
      };
  }
  return null;
}
