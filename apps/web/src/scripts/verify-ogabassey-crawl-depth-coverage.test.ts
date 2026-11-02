import { describe, expect, it } from 'vitest';
import {
  buildCrawlDepthCoverageReport,
  classifyCrawlDepthUrl,
  collectModuleHrefs,
  formatCrawlDepthCoverageReport,
  isCoveredByMaintainedModules,
} from './verify-ogabassey-crawl-depth-coverage';

describe('verify Ogabassey crawl-depth coverage', () => {
  it('classifies dead and redirecting rows as cleanup instead of module targets', () => {
    expect(classifyCrawlDepthUrl('https://installments.ogabassey.com')).toEqual(
      { kind: 'redirect-cleanup', path: '/' }
    );
    expect(
      classifyCrawlDepthUrl('https://ogabassey.com/categories/smartphones')
    ).toEqual({ kind: 'broken-cleanup', path: '/categories/smartphones' });
    expect(
      classifyCrawlDepthUrl('https://ogabassey.com/products/demo')
    ).toEqual({
      kind: 'demo-cleanup',
      path: '/products/demo',
    });
  });

  it('classifies maintained routes by target kind', () => {
    expect(
      classifyCrawlDepthUrl(
        'https://ogabassey.com/smartphones/iphone-xr-3gb-128gb'
      )
    ).toEqual({
      kind: 'product',
      path: '/smartphones/iphone-xr-3gb-128gb',
    });
    expect(
      classifyCrawlDepthUrl(
        'https://ogabassey.com/smartphones/compare/iphone-12-vs-xiaomi-13t'
      )
    ).toEqual({
      kind: 'compare',
      path: '/smartphones/compare/iphone-12-vs-xiaomi-13t',
    });
  });

  it('classifies non-compare rows for separate pagination and archive handling', () => {
    expect(
      classifyCrawlDepthUrl('https://ogabassey.com/blog?category=review&page=2')
    ).toEqual({
      kind: 'blog-pagination-cleanup',
      path: '/blog?category=review&page=2',
    });
    expect(
      classifyCrawlDepthUrl('https://ogabassey.com/blog/category/review')
    ).toEqual({
      canonicalPath: '/blog/category/reviews',
      kind: 'blog-category-alias-cleanup',
      path: '/blog/category/review',
    });
    expect(
      classifyCrawlDepthUrl('https://ogabassey.com/smartphones?page=2&brand=Apple')
    ).toEqual({
      kind: 'listing-page',
      path: '/smartphones?brand=Apple&page=2',
    });
  });

  it('proves compare and listing rows are covered by maintained module hrefs', () => {
    const moduleHrefs = new Set([
      '/smartphones',
      '/smartphones?page=6',
      '/smartphones/compare/iphone-12-vs-xiaomi-13t',
      '/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
      '/laptops/compare/dell-14-plus-2-in-1-vs-lenovo-thinkpad-x1-carbon-gen-7',
    ]);

    expect(
      isCoveredByMaintainedModules(
        {
          kind: 'compare',
          path: '/smartphones/compare/iphone-12-vs-xiaomi-13t',
        },
        moduleHrefs
      )
    ).toBe(true);
    expect(
      isCoveredByMaintainedModules(
        {
          kind: 'compare',
          path: '/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
        },
        moduleHrefs
      )
    ).toBe(true);
    expect(
      isCoveredByMaintainedModules(
        {
          kind: 'compare',
          path: '/laptops/compare/dell-14-plus-2-in-1-vs-lenovo-thinkpad-x1-carbon-gen-7',
        },
        moduleHrefs
      )
    ).toBe(true);
    expect(
      isCoveredByMaintainedModules(
        { kind: 'listing-page', path: '/smartphones?page=6' },
        moduleHrefs
      )
    ).toBe(true);
  });

  it('summarizes dominant one-internal-link compare clusters', () => {
    const urls = [
      'https://ogabassey.com/smartphones/compare/iphone-12-vs-xiaomi-13t',
      'https://ogabassey.com/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
      'https://ogabassey.com/laptops/compare/dell-14-plus-2-in-1-vs-lenovo-thinkpad-x1-carbon-gen-7',
      'https://ogabassey.com/products/demo',
    ];
    const moduleHrefs = collectModuleHrefs({
      modules: [
        {
          items: [
            { href: '/smartphones/compare/iphone-12-vs-xiaomi-13t' },
            { href: '/smartphones/compare/google-pixel-8-vs-xiaomi-13t' },
            {
              href: '/laptops/compare/dell-14-plus-2-in-1-vs-lenovo-thinkpad-x1-carbon-gen-7',
            },
          ],
        },
      ],
    });

    expect(buildCrawlDepthCoverageReport(urls, moduleHrefs)).toMatchObject({
      cleanupRows: 1,
      coveredMaintainedRows: 3,
      missingMaintainedRows: 0,
      clusters: {
        'vs-lenovo-thinkpad-x1-carbon-gen-7': {
          coveredRows: 1,
          missingRows: 0,
          totalRows: 1,
        },
        'vs-xiaomi-13t': {
          coveredRows: 2,
          missingRows: 0,
          totalRows: 2,
        },
      },
    });
  });

  it('formats CLI output as concise proof lines', () => {
    const report = buildCrawlDepthCoverageReport(
      [
        'https://ogabassey.com/smartphones/compare/iphone-12-vs-xiaomi-13t',
        'https://ogabassey.com/products/demo',
      ],
      new Set(['/smartphones/compare/iphone-12-vs-xiaomi-13t'])
    );

    expect(formatCrawlDepthCoverageReport(report)).toContain(
      'total_rows 2\ncovered_maintained_rows 1\nmissing_maintained_rows 0\ncleanup_rows 1'
    );
    expect(formatCrawlDepthCoverageReport(report)).toContain(
      'cluster vs-xiaomi-13t covered_representative true'
    );
  });

  it('does not count external or malformed module hrefs as internal inventory', () => {
    const target = 'https://ogabassey.com/smartphones/fixture-phone';
    for (const href of [
      'https://example.invalid/smartphones/fixture-phone',
      'https://ogabassey.com.example.invalid/smartphones/fixture-phone',
      '//example.invalid/smartphones/fixture-phone',
      'https://user@ogabassey.com/smartphones/fixture-phone',
      'https://:secret@ogabassey.com/smartphones/fixture-phone',
      'http://ogabassey.com/smartphones/fixture-phone',
      'http://[broken',
      'javascript:alert(1)',
    ]) {
      for (const value of [href, { href }]) {
        const report = buildCrawlDepthCoverageReport([target], collectModuleHrefs(value));
        expect(report.missingMaintainedRows).toBe(1);
        expect(report.coveredMaintainedRows).toBe(0);
      }
    }
    for (const href of [
      '/smartphones/fixture-phone',
      'smartphones/fixture-phone',
      'https://ogabassey.com/smartphones/fixture-phone',
      '//ogabassey.com/smartphones/fixture-phone',
    ]) {
      for (const value of [href, { href }]) {
        expect(buildCrawlDepthCoverageReport([target], collectModuleHrefs(value)).coveredMaintainedRows).toBe(1);
      }
    }
  });

  it('does not treat object metadata as an href', () => {
    expect(collectModuleHrefs({ title: '/smartphones/fixture-phone' }).size).toBe(0);
  });

  it('labels output as module inventory, not live crawl evidence', () => {
    expect(formatCrawlDepthCoverageReport(buildCrawlDepthCoverageReport([], new Set()))).toContain('module_inventory_coverage');
  });

  it('reports missing maintained rows with samples', () => {
    const report = buildCrawlDepthCoverageReport(
      [
        'https://ogabassey.com/smartphones/compare/iphone-12-vs-xiaomi-13t',
        'https://ogabassey.com/smartphones/iphone-xr-3gb-128gb',
      ],
      new Set(['/smartphones/compare/iphone-12-vs-xiaomi-13t'])
    );

    expect(report.missingMaintainedRows).toBe(1);
    expect(report.missing).toEqual([
      {
        kind: 'product',
        path: '/smartphones/iphone-xr-3gb-128gb',
      },
    ]);
    expect(formatCrawlDepthCoverageReport(report)).toContain(
      'missing_samples\nproduct /smartphones/iphone-xr-3gb-128gb'
    );
  });

  it('treats malformed crawl-depth rows as missing instead of aborting', () => {
    const report = buildCrawlDepthCoverageReport(
      ['not a url'],
      new Set<string>()
    );

    expect(report.missingMaintainedRows).toBe(1);
    expect(report.missing).toEqual([
      {
        kind: 'unparseable',
        path: 'not a url',
      },
    ]);
  });

  it('treats malformed blog category percent-encoding as missing instead of aborting', () => {
    const report = buildCrawlDepthCoverageReport(
      ['https://ogabassey.com/blog/category/50%'],
      new Set<string>()
    );

    expect(report.missingMaintainedRows).toBe(1);
    expect(report.missing).toEqual([
      {
        kind: 'unparseable',
        path: '/blog/category/50%',
      },
    ]);
    expect(formatCrawlDepthCoverageReport(report)).toContain(
      'unparseable /blog/category/50%'
    );
  });
});
