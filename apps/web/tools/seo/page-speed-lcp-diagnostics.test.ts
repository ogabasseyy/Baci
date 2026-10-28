import { describe, expect, it } from 'vitest';
import {
  computeMedian,
  evaluatePageSpeedMultiRunSeries,
  extractPageSpeedLcpDiagnostics,
  OGABASSEY_MONITORED_CWV_ROUTES,
} from './page-speed-lcp-diagnostics';
import { pageSpeedTools } from './run-pagespeed';

function buildSampleLighthousePayload(overrides?: {
  cls?: number;
  fcpMs?: number;
  includeDiscoveryUrl?: boolean;
  lcpMs?: number;
  lcpSelector?: string;
  lcpSnippet?: string;
  lcpUrl?: string;
  networkUrls?: string[];
  optimisticLcp?: number;
  perfScore?: number;
  pessimisticLcp?: number;
  seoScore?: number;
}) {
  const lcpUrl =
    overrides?.lcpUrl ??
    'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/iphone-16.avif';
  const networkUrls = overrides?.networkUrls ?? [lcpUrl];
  return {
    lighthouseResult: {
      categories: {
        performance: { score: overrides?.perfScore ?? 0.91 },
        seo: { score: overrides?.seoScore ?? 1 },
      },
      audits: {
        'first-contentful-paint': {
          numericValue: overrides?.fcpMs ?? 1168,
        },
        'largest-contentful-paint': {
          numericValue: overrides?.lcpMs ?? 3146,
          details: {
            optimisticLcp: overrides?.optimisticLcp ?? 2980,
            pessimisticLcp: overrides?.pessimisticLcp ?? 3312,
          },
        },
        'cumulative-layout-shift': {
          numericValue: overrides?.cls ?? 0,
        },
        'lcp-breakdown-insight': {
          details: {
            items: [
              {
                node: {
                  selector: overrides?.lcpSelector ?? 'picture.block > img',
                  snippet:
                    overrides?.lcpSnippet ??
                    `<img src="${lcpUrl}" fetchpriority="high">`,
                },
              },
            ],
          },
        },
        ...(overrides?.includeDiscoveryUrl !== false
          ? {
              'lcp-discovery-insight': {
                details: {
                  items: [{ url: lcpUrl }],
                },
              },
            }
          : {}),
        'network-requests': {
          details: {
            items: [
              { resourceType: 'Document', transferSize: 55_000 },
              { resourceType: 'Stylesheet', transferSize: 22_000 },
              { resourceType: 'Script', transferSize: 180_000 },
              ...networkUrls.map((url) => ({
                resourceType: 'Image',
                transferSize: 18_500,
                url,
              })),
            ],
          },
        },
      },
    },
  };
}

describe('page-speed-lcp-diagnostics', () => {
  it('defines the 6 canonical monitored storefront routes and wires into evaluatePageSpeedResult', () => {
    expect(OGABASSEY_MONITORED_CWV_ROUTES.map((r) => r.route)).toEqual([
      'home',
      'category',
      'brandHub',
      'familyHub',
      'pdp',
      'blogPost',
    ]);

    const auditResult = pageSpeedTools.evaluatePageSpeedResult(
      buildSampleLighthousePayload({ fcpMs: 1100, lcpMs: 2100 })
    );
    expect(auditResult.lcpDiagnostics?.simLcpMs).toBe(2100);
    expect(auditResult.lcpDiagnostics?.lcpElement).toBe('picture.block > img');
    expect(auditResult.lcpDiagnostics?.lcpResourceOrigin).toBe(
      'https://cdn.ogabassey.com'
    );
  });

  it('extracts Lantern optimistic/pessimistic LCP, LCP element, and unambiguous truncated snippet URL', () => {
    const fullUrl =
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/iphone-16.avif';
    const diag = extractPageSpeedLcpDiagnostics(
      buildSampleLighthousePayload({
        includeDiscoveryUrl: false,
        lcpSnippet:
          '<img src="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-asse\u2026">',
        lcpUrl: fullUrl,
      })
    );

    expect(diag.performanceScore).toBe(91);
    expect(diag.seoScore).toBe(100);
    expect(diag.simFcpMs).toBe(1168);
    expect(diag.simLcpMs).toBe(3146);
    expect(diag.lcpOptimisticMs).toBe(2980);
    expect(diag.lcpPessimisticMs).toBe(3312);
    expect(diag.lcpElement).toBe('picture.block > img');
    expect(diag.lcpResourceUrl).toBe(fullUrl);
    expect(diag.lcpResourceOrigin).toBe('https://cdn.ogabassey.com');

    // Ambiguous truncated prefix (2 matching images) returns null instead of guessing
    const ambiguous = extractPageSpeedLcpDiagnostics(
      buildSampleLighthousePayload({
        includeDiscoveryUrl: false,
        lcpSnippet:
          '<img src="https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-asse\u2026">',
        networkUrls: [
          fullUrl,
          'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/other.avif',
        ],
      })
    );
    expect(ambiguous.lcpResourceUrl).toBeNull();
    expect(ambiguous.lcpResourceOrigin).toBeNull();
  });

  it('returns null resource URL and origin for text LCP elements even when discovery insight has a URL', () => {
    const diag = extractPageSpeedLcpDiagnostics(
      buildSampleLighthousePayload({
        includeDiscoveryUrl: true,
        lcpSelector: 'header.space-y-3 > p.max-w-3xl',
        lcpSnippet: '<p class="max-w-3xl">Compare Apple iPhones in Nigeria</p>',
      })
    );

    expect(diag.lcpElement).toBe('header.space-y-3 > p.max-w-3xl');
    expect(diag.lcpResourceUrl).toBeNull();
    expect(diag.lcpResourceOrigin).toBeNull();
  });

  it('computes 5-run median and passes when LCP element, origin, spread, and regression are within budget', () => {
    const runs = [2210, 2280, 2190, 2310, 2240].map((lcpMs) =>
      extractPageSpeedLcpDiagnostics(
        buildSampleLighthousePayload({
          lcpMs,
          lcpSelector: 'div > picture > img',
          lcpUrl:
            'https://ogabassey.com/cdn-image/width=384,quality=60,format=avif/core-assets/products/iphone-16.avif',
        })
      )
    );

    const summary = evaluatePageSpeedMultiRunSeries(runs, {
      baselineMedianSimLcpMs: 2200,
      expectedLcpElement: 'picture > img',
      expectedLcpOrigin: 'https://ogabassey.com',
      maxAllowedSpreadMs: 150,
      maxRegressionDeltaMs: 300,
    });

    expect(computeMedian([10, 30])).toBe(20);
    expect(summary.passed).toBe(true);
    expect(summary.medianSimLcpMs).toBe(2240);
    expect(summary.lcpSpreadMs).toBe(120);
    expect(summary.lcpElementConsistent).toBe(true);
    expect(summary.lcpOriginConsistent).toBe(true);
    expect(summary.alerts).toEqual([]);
  });

  it('flags fewer than 5 runs, partial missing identity, non-terminal selector mismatch, origin drift, spread, and regression', () => {
    const runs = [
      extractPageSpeedLcpDiagnostics(
        buildSampleLighthousePayload({
          lcpMs: 2200,
          lcpSelector: 'div > picture > img.other',
          lcpUrl: 'https://ogabassey.com/cdn-image/hero.avif',
        })
      ),
      extractPageSpeedLcpDiagnostics(
        buildSampleLighthousePayload({
          lcpMs: 2950,
          lcpSelector: 'header > h2.line-clamp-3',
          lcpSnippet: '<h2>itel IPL-51314H</h2>',
        })
      ),
      {
        ...extractPageSpeedLcpDiagnostics(
          buildSampleLighthousePayload({ lcpMs: 2800 })
        ),
        lcpElement: null,
        lcpResourceOrigin: null,
      },
    ];

    const summary = evaluatePageSpeedMultiRunSeries(runs, {
      baselineMedianSimLcpMs: 2200,
      expectedLcpElement: 'picture > img',
      expectedLcpOrigin: 'https://ogabassey.com',
      maxAllowedSpreadMs: 150,
      maxRegressionDeltaMs: 300,
    });

    expect(summary.passed).toBe(false);
    expect(summary.alerts).toEqual(
      expect.arrayContaining([
        'Expected at least 5 runs for multi-run evaluation, received 3',
        'One or more runs are missing LCP element diagnostics',
        'One or more runs are missing LCP resource origin diagnostics',
        'LCP element flipped across runs: div > picture > img.other vs header > h2.line-clamp-3',
        'LCP element drifted from expected "picture > img": found div > picture > img.other, header > h2.line-clamp-3',
        'Simulated LCP spread 750ms exceeds 150ms stability cap',
        'Median simulated LCP regressed by 600ms (threshold 300ms)',
      ])
    );
  });
});
