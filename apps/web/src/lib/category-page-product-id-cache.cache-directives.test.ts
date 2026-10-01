import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TypeScript from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { getFunctionSourceFrom } from './get-function-source-from';

const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6') as typeof TypeScript;
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const CACHED_DATA_SOURCE = readFileSync(
  join(toolDirectory, 'cached-data.ts'),
  'utf8'
);
const CACHED_DATA_AST = ts.createSourceFile(
  'cached-data.ts',
  CACHED_DATA_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const CATEGORY_PAGE_PRODUCT_ID_CACHE_SOURCE = readFileSync(
  join(toolDirectory, 'category-page-product-id-cache.ts'),
  'utf8'
);
const CATEGORY_PAGE_PRODUCT_ID_CACHE_AST = ts.createSourceFile(
  'category-page-product-id-cache.ts',
  CATEGORY_PAGE_PRODUCT_ID_CACHE_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function getFunctionSource(functionName: string): string {
  return getFunctionSourceFrom(
    functionName,
    CACHED_DATA_SOURCE,
    CACHED_DATA_AST
  );
}

function getCategoryPageProductIdCacheFunctionSource(
  functionName: string
): string {
  return getFunctionSourceFrom(
    functionName,
    CATEGORY_PAGE_PRODUCT_ID_CACHE_SOURCE,
    CATEGORY_PAGE_PRODUCT_ID_CACHE_AST
  );
}

describe('category page product ID cache directives', () => {
  it('keeps canonical category product IDs on the shared store while legacy IDs stay local', () => {
    const source = getCategoryPageProductIdCacheFunctionSource(
      'getCachedCategoryPageProductIds'
    );
    expect(source).toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('storefront-page');");
    expect(source).toContain('cacheTag(');
    expect(source).toContain('CATEGORY_PAGE_PRODUCT_ID_CAP');
    expect(source).toContain('.limit(CATEGORY_PAGE_PRODUCT_ID_CAP)');
    expect(CATEGORY_PAGE_PRODUCT_ID_CACHE_SOURCE).toContain(
      'CATEGORY_PAGE_PRODUCT_ID_CAP'
    );
    expect(source).toContain('getCategoryPageDataCacheTag(merchantId)');

    const legacySource = getCategoryPageProductIdCacheFunctionSource(
      'getCachedLegacyCategoryPageProductIds'
    );
    expect(legacySource).toContain("'use cache';");
    expect(legacySource).not.toContain("'use cache: remote';");
    expect(legacySource).toContain('getCategoryPageDataCacheTag(merchantId)');
  });

  it('caches the exact count as its OWN entry so a count failure cannot empty the catalog (PR4b review r4)', () => {
    const idsSource = getCategoryPageProductIdCacheFunctionSource(
      'getCachedCategoryPageProductIds'
    );
    const countSource = getCategoryPageProductIdCacheFunctionSource(
      'getCachedCategoryPageProductTotalCount'
    );
    const boundarySource = getFunctionSource('getCategoryPageProductIds');

    expect(idsSource).not.toContain("count: 'exact'");
    expect(countSource).toContain("'use cache: remote';");
    expect(countSource).toContain("count: 'exact'");
    expect(countSource).not.toContain('=== CATEGORY_PAGE_PRODUCT_ID_CAP');

    const legacyCountSource = getCategoryPageProductIdCacheFunctionSource(
      'getCachedLegacyCategoryPageProductTotalCount'
    );
    expect(legacyCountSource).toContain("'use cache';");
    expect(legacyCountSource).not.toContain("'use cache: remote';");
    expect(legacyCountSource).toContain("count: 'exact'");

    expect(boundarySource).toContain('totalProductCountExact: false');
    expect(boundarySource).toContain('totalProductCount: productIds.length');
  });

  it('keeps pagination truthful past the capped ID list (PR4b review fix)', () => {
    const countSource = getCategoryPageProductIdCacheFunctionSource(
      'getCachedCategoryPageProductTotalCount'
    );
    expect(countSource).toContain("count: 'exact'");
    const aggregateSource = getFunctionSource(
      'getCachedCategoryPageProductsUncached'
    );
    expect(aggregateSource).toContain('totalProductCount');
    expect(aggregateSource).toContain(
      'categoryPageProductIdCache.fetchProductIdWindow'
    );
    expect(aggregateSource).toContain('fetchAllCategoryPageProductIds');
    expect(aggregateSource).toContain('totalProductCountExact');
  });
});
