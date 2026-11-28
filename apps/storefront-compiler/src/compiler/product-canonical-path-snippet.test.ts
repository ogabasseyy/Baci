import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildProductCanonicalPathSnippet } from './product-canonical-path-snippet';

function buildResolver(routes: Array<{ path: string; view: string }>) {
  const ctx: Record<string, unknown> = {
    DECLARED_ROUTES: routes,
    encodeURIComponent,
    Array,
    Set,
    String,
  };
  vm.runInNewContext(
    `${buildProductCanonicalPathSnippet()}\nglobalThis.resolve = resolveProductCanonicalPath;`,
    ctx
  );
  return ctx.resolve as (p: Record<string, unknown>) => string | undefined;
}

describe('product-canonical-path-snippet', () => {
  it('builds /:category/:productSlug paths and omits :sku paths when variant SKUs are ambiguous', () => {
    const resolveCat = buildResolver([
      { path: '/:category/:productSlug', view: 'product' },
    ]);
    expect(resolveCat({ slug: 'iphone-16', categorySlug: 'smartphones' })).toBe(
      '/smartphones/iphone-16'
    );

    const resolveSku = buildResolver([
      { path: '/products/:sku', view: 'product' },
    ]);
    expect(
      resolveSku({
        slug: 'iphone-16',
        variants: [
          { id: 'v1', sku: 'SKU-1' },
          { id: 'v2', sku: 'SKU-2' },
        ],
      })
    ).toBeUndefined();
    expect(
      resolveSku({
        slug: 'iphone-16',
        variants: [{ id: 'v1', sku: 'SKU-ONLY' }],
      })
    ).toBe('/products/SKU-ONLY');
  });
});
