import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  validateComposablePublishedRoute,
  validateRouteViewShape,
} from './composable-route-guard';

function runComposableCheck(route: { path: string; view: string }) {
  return z
    .object({ path: z.string(), view: z.string() })
    .superRefine((val, ctx) => {
      validateComposablePublishedRoute(val, ctx);
    })
    .safeParse(route);
}

describe('composable-route-guard', () => {
  it('accepts exact host-supported routes in composable mode and rejects /search, /cart, colon params, and reserved /pages/*', () => {
    for (const valid of [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
      { path: '/pages/our-story', view: 'editorial' },
    ]) {
      expect(runComposableCheck(valid).success).toBe(true);
    }

    for (const invalid of [
      { path: '/search', view: 'search' },
      { path: '/cart', view: 'cart' },
      { path: '/:category', view: 'collection' },
      { path: '/products/:slug', view: 'product' },
      { path: '/pages/about', view: 'editorial' },
      { path: '/pages/[slug]', view: 'editorial' },
      { path: '/pages//story', view: 'editorial' },
      { path: '/pages/story/', view: 'editorial' },
    ]) {
      expect(runComposableCheck(invalid).success).toBe(false);
    }
  });

  it('validates dynamic vs static route shape constraints via validateRouteViewShape', () => {
    const checkShape = (
      route: { path: string; view: string },
      hasDynamic: boolean,
      params: string[]
    ) =>
      z
        .object({ path: z.string(), view: z.string() })
        .superRefine((val, ctx) =>
          validateRouteViewShape(val, hasDynamic, new Set(params), ctx)
        )
        .safeParse(route);

    expect(checkShape({ path: '/', view: 'home' }, false, []).success).toBe(
      true
    );
    expect(
      checkShape({ path: '/collections', view: 'collection' }, false, [])
        .success
    ).toBe(false);
    expect(
      checkShape({ path: '/products', view: 'product' }, false, []).success
    ).toBe(false);
    expect(
      checkShape({ path: '/products/:variantId', view: 'product' }, true, [
        'variantId',
      ]).success
    ).toBe(false);
  });
});
