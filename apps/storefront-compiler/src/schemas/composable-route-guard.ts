import type { z } from 'zod';
import { isValidProductRouteParams } from './origin-schemas';

const RESERVED_PUBLISHED_EXPERIENCE_PAGES: ReadonlySet<string> = new Set([
  'about',
  'contact',
  'faq',
  'privacy',
  'terms',
  'rewards',
  'blog',
]);

function isLegalStaticEditorialPath(path: string): boolean {
  if (
    !path.startsWith('/pages/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('[') ||
    path.includes(']') ||
    path.includes(':')
  ) {
    return false;
  }
  const parts = path.split('/').slice(1);
  if (
    parts.length < 2 ||
    parts.some((p) => p === '' || p === '.' || p === '..')
  ) {
    return false;
  }
  return !RESERVED_PUBLISHED_EXPERIENCE_PAGES.has(
    parts[1]?.toLowerCase() ?? ''
  );
}

export function validateComposablePublishedRoute(
  route: { path: string; view: string },
  ctx: z.RefinementCtx
): void {
  const { path, view } = route;
  if (view === 'search' || view === 'cart') {
    ctx.addIssue({
      code: 'custom',
      message: `Composable framed route "${path}" cannot declare "${view}"; published host frames only permit home, collection, product, and editorial views`,
    });
    return;
  }
  const legal =
    (path === '/' && view === 'home') ||
    (path === '/collections/[handle]' && view === 'collection') ||
    (path === '/products/[handle]' && view === 'product') ||
    (view === 'editorial' && isLegalStaticEditorialPath(path));
  if (!legal) {
    ctx.addIssue({
      code: 'custom',
      message: `Composable framed route "${path}" (${view}) is incompatible with published host route ownership`,
    });
  }
}

export function validateRouteViewShape(
  route: { path: string; view: string },
  hasDynamic: boolean,
  paramNames: ReadonlySet<string>,
  ctx: z.RefinementCtx
): void {
  if (
    (route.view === 'collection' || route.view === 'product') &&
    !hasDynamic
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `${route.view} route "${route.path}" must capture a dynamic segment`,
    });
  } else if (
    route.view === 'product' &&
    !isValidProductRouteParams(Array.from(paramNames))
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `product route "${route.path}" must capture a product-identifying parameter with recognized qualifier segments`,
    });
  }
}
