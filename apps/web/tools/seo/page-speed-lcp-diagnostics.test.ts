import { describe, expect, it } from 'vitest';
import {
  evaluatePageSpeedMultiRunSeries,
  extractPageSpeedLcpDiagnostics,
  OGABASSEY_MONITORED_CWV_ROUTES,
} from './page-speed-lcp-diagnostics';

describe('page-speed-lcp-diagnostics', () => {
  it('defines the 5 monitored OgaBassey routes from the CWV master plan', () => {
    expect(OGABASSEY_MONITORED_CWV_ROUTES.map((r) => r.label)).toEqual([
      'ogabassey-home',
      'ogabassey-category',
      'ogabassey-brand-hub',
      'ogabassey-pdp',
      'ogabassey-blog',
    ]);
  });

  it('resolves truncated LCP node snippet src against network-requests and ignores unrelated images on text LCP', () => {
    const imageLcpDiag = extractPageSpeedLcpDiagnostics({
      lighthouseResult: {
        audits: {
          'first-contentful-paint': { numericValue: 1912.1 },
          'largest-contentful-paint': { numericValue: 3146.2 },
          'lcp-breakdown-insight': {
            details: {
              items: [
                {
                  type: 'node',
                  selector:
                    'div.absolute > div.relative > picture.block > img.h-full',
                  snippet:
                    '<img alt="iPhone Duo" fetchpriority="high" src="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-asse\u2026">',
                },
              ],
            },
          },
          'lcp-discovery-insight': {
            details: {
              items: [
                { type: 'checklist' },
                {
                  type: 'node',
                  selector:
                    'div.absolute > div.relative > picture.block > img.h-full',
                  snippet:
                    '<img alt="iPhone Duo" fetchpriority="high" src="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-asse\u2026">',
                },
              ],
            },
          },
          'network-requests': {
            details: {
              items: [
                {
                  resourceType: 'Image',
                  priority: 'High',
                  url: 'https://untrusted.example.com/unrelated-banner.avif',
                },
                {
                  resourceType: 'Image',
                  priority: 'High',
                  url: 'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/iphone-duo-night-sky-20261026.avif',
                },
              ],
            },
          },
        },
      },
    });

    expect(imageLcpDiag).toEqual({
      lcpElement: 'div.absolute > div.relative > picture.block > img.h-full',
      lcpResourceOrigin: 'https://cdn.ogabassey.com',
      lcpResourceUrl:
        'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/iphone-duo-night-sky-20261026.avif',
      simFcpMs: 1912,
      simLcpMs: 3146,
    });

    const textLcpDiag = extractPageSpeedLcpDiagnostics({
      lighthouseResult: {
        audits: {
          'first-contentful-paint': { numericValue: 1333 },
          'largest-contentful-paint': { numericValue: 5546 },
          'lcp-breakdown-insight': {
            details: {
              items: [
                {
                  type: 'node',
                  selector: 'header.space-y-3 > p.max-w-3xl',
                  snippet: '<p class="max-w-3xl text-base leading-7">',
                },
              ],
            },
          },
          'network-requests': {
            details: {
              items: [
                {
                  resourceType: 'Image',
                  priority: 'High',
                  url: 'https://cdn.ogabassey.com/products/card-1.avif',
                },
              ],
            },
          },
        },
      },
    });

    expect(textLcpDiag.lcpElement).toBe('header.space-y-3 > p.max-w-3xl');
    expect(textLcpDiag.lcpResourceUrl).toBeNull();
    expect(textLcpDiag.lcpResourceOrigin).toBeNull();
  });

  it('computes 5-run median and range and passes when element, origin, and regression stay within bounds', () => {
    const summary = evaluatePageSpeedMultiRunSeries({
      runs: [
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/cdn-image/hero.avif',
          simFcpMs: 1400,
          simLcpMs: 2150,
        },
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/cdn-image/hero.avif',
          simFcpMs: 1420,
          simLcpMs: 2210,
        },
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/cdn-image/hero.avif',
          simFcpMs: 1390,
          simLcpMs: 2180,
        },
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/cdn-image/hero.avif',
          simFcpMs: 1410,
          simLcpMs: 2240,
        },
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/cdn-image/hero.avif',
          simFcpMs: 1405,
          simLcpMs: 2190,
        },
      ],
      baseline: {
        expectedLcpElement: 'picture > img',
        expectedLcpOrigin: 'https://ogabassey.com',
        medianLcpMs: 2100,
      },
      maxIntraSeriesSpreadMs: 150,
      maxLcpRegressionMs: 300,
    });

    expect(summary.passed).toBe(true);
    expect(summary.medianLcpMs).toBe(2190);
    expect(summary.medianFcpMs).toBe(1405);
    expect(summary.rangeLcpMs).toEqual([2150, 2240]);
    expect(summary.spreadLcpMs).toBe(90);
    expect(summary.alerts).toEqual([]);
  });

  it('alerts on LCP element flip, origin drift, > 300ms median regression, and > 150ms fixture spread', () => {
    const summary = evaluatePageSpeedMultiRunSeries({
      runs: [
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://cdn.ogabassey.com',
          lcpResourceUrl: 'https://cdn.ogabassey.com/hero.avif',
          simFcpMs: 1800,
          simLcpMs: 2900,
        },
        {
          lcpElement: 'h2.hero-heading',
          lcpResourceOrigin: 'https://cdn.ogabassey.com',
          lcpResourceUrl: 'https://cdn.ogabassey.com/hero.avif',
          simFcpMs: 1850,
          simLcpMs: 3350,
        },
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://cdn.ogabassey.com',
          lcpResourceUrl: 'https://cdn.ogabassey.com/hero.avif',
          simFcpMs: 1820,
          simLcpMs: 3400,
        },
      ],
      baseline: {
        expectedLcpElement: 'picture > img',
        expectedLcpOrigin: 'https://ogabassey.com',
        medianLcpMs: 2800,
      },
      maxIntraSeriesSpreadMs: 150,
      maxLcpRegressionMs: 300,
    });

    expect(summary.passed).toBe(false);
    expect(summary.alerts).toEqual([
      'LCP element flipped across runs: picture > img vs h2.hero-heading',
      'LCP element "picture > img, h2.hero-heading" drifted from expected "picture > img"',
      'LCP origin "https://cdn.ogabassey.com" drifted from expected "https://ogabassey.com"',
      'Median simLCP 3350ms regressed by 550ms (> 300ms) from baseline 2800ms',
      'simLCP spread 500ms exceeds stability cap 150ms',
    ]);
  });

  it('fails closed when runs are empty, partial, all null, or expected LCP element/origin is missing', () => {
    const emptyRuns = evaluatePageSpeedMultiRunSeries({ runs: [] });
    expect(emptyRuns.passed).toBe(false);
    expect(emptyRuns.alerts).toEqual([
      'No simLCP values extracted from any run',
    ]);

    const partialRuns = evaluatePageSpeedMultiRunSeries({
      runs: [
        {
          lcpElement: 'picture > img',
          lcpResourceOrigin: 'https://ogabassey.com',
          lcpResourceUrl: 'https://ogabassey.com/hero.avif',
          simFcpMs: 1500,
          simLcpMs: 2100,
        },
        {
          lcpElement: null,
          lcpResourceOrigin: null,
          lcpResourceUrl: null,
          simFcpMs: null,
          simLcpMs: null,
        },
      ],
    });
    expect(partialRuns.passed).toBe(false);
    expect(partialRuns.alerts).toEqual([
      'simLCP extracted from only 1 of 2 runs',
    ]);

    const nullRuns = evaluatePageSpeedMultiRunSeries({
      runs: [
        {
          lcpElement: null,
          lcpResourceOrigin: null,
          lcpResourceUrl: null,
          simFcpMs: null,
          simLcpMs: null,
        },
      ],
      baseline: {
        expectedLcpElement: 'picture > img',
        expectedLcpOrigin: 'https://ogabassey.com',
      },
    });
    expect(nullRuns.passed).toBe(false);
    expect(nullRuns.alerts).toEqual([
      'No simLCP values extracted from any run',
      'No LCP element extracted from any run',
      'No LCP resource origin extracted from any run',
    ]);
  });
});
