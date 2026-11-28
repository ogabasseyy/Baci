import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';

describe('route-matcher-snippet', () => {
  it('ranks static routes ahead of dynamic routes, rejects /_baci, and flags malformed percent-encoding', () => {
    const ctx: Record<string, unknown> = {
      DECLARED_ROUTES: [
        { path: '/:category', view: 'collection' },
        { path: '/search', view: 'search' },
        { path: '/products/[handle]', view: 'product' },
      ],
      decodeURIComponent,
      Array,
      Object,
      Math,
    };
    vm.runInNewContext(
      `${buildDeclaredRouteMatcherSnippet()}\nglobalThis.match = matchDeclaredRoute;`,
      ctx
    );
    const match = ctx.match as (
      p: string
    ) => { view: string; params: Record<string, string> } | null;

    expect(match('/search')?.view).toBe('search');
    expect(match('/smartphones')).toEqual({
      view: 'collection',
      params: { category: 'smartphones' },
    });
    expect(match('/products/iphone-16')).toEqual({
      view: 'product',
      params: { handle: 'iphone-16' },
    });
    expect(match('/_baci/catalog')).toBeNull();
    expect(match('/products/%FF')?.view).toBe('bad_request');
  });
});
