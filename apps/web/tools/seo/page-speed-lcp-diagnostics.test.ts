import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeMedian,
  evaluatePageSpeedMultiRunSeries,
  extractPageSpeedLcpDiagnostics,
  matchesExpectedSelector,
  OGABASSEY_MONITORED_CWV_ROUTES,
} from './page-speed-lcp-diagnostics';
import { pageSpeedTools } from './run-pagespeed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_PSI_PDP_REPORT_PATH = path.resolve(
  __dirname,
  '../../../../output/audits/psi-ogabassey-pdp-mobile-20260601.json'
);

function buildMockPsiReport(overrides: {
  cls?: number;
  fcpMs?: number;
  lcpElementSelector?: string;
  lcpElementSnippet?: string;
  lcpMs?: number;
  lcpResourceUrl?: string;
  networkItems?: Record<string, unknown>[];
  observedLcpMs?: number;
  performanceScore?: number;
  seoScore?: number;
}) {
  const selector = overrides.lcpElementSelector ?? 'picture.block > img';
  const isImg = /(?:^|[\s>+~])(?:img|picture|source|svg|video)\b/i.test(
    selector
  );
  const url =
    overrides.lcpResourceUrl ??
    'https://cdn.ogabassey.com/image/width=640,quality=70,format=avif/core-assets/products/hero.avif';
  const snippet =
    overrides.lcpElementSnippet ??
    (isImg ? `<img src="${url}">` : '<h2>Launch</h2>');
  const observedLcpMs = overrides.observedLcpMs ?? overrides.lcpMs ?? 2100;

  return {
    lighthouseResult: {
      categories: {
        performance: { score: (overrides.performanceScore ?? 94) / 100 },
        seo: { score: (overrides.seoScore ?? 100) / 100 },
      },
      audits: {
        'first-contentful-paint': { numericValue: overrides.fcpMs ?? 1260 },
        'largest-contentful-paint': { numericValue: overrides.lcpMs ?? 2100 },
        'cumulative-layout-shift': { numericValue: overrides.cls ?? 0 },
        metrics: {
          details: {
            items: [
              {
                firstContentfulPaint: overrides.fcpMs ?? 1260,
                largestContentfulPaint: overrides.lcpMs ?? 2100,
                lcpLoadDelay: 120,
                lcpLoadDuration: 450,
                observedLargestContentfulPaint: observedLcpMs,
              },
            ],
          },
        },
        'lcp-breakdown-insight': {
          details: {
            items: [
              {
                type: 'table',
                items: [
                  { subpart: 'timeToFirstByte', duration: 300 },
                  { subpart: 'resourceLoadDelay', duration: 120 },
                  { subpart: 'resourceLoadDuration', duration: 450 },
                  { subpart: 'elementRenderDelay', duration: 80 },
                ],
              },
              {
                type: 'node',
                selector,
                snippet,
              },
            ],
          },
        },
        'network-requests': {
          details: {
            items: overrides.networkItems ?? [
              {
                networkRequestTime: 1,
                networkEndTime: 300,
                resourceType: 'Document',
                transferSize: 42_000,
                url: 'https://ogabassey.com/',
              },
              {
                networkRequestTime: 310,
                networkEndTime: 400,
                resourceType: 'Stylesheet',
                transferSize: 18_000,
                url: 'https://ogabassey.com/_next/static/css/app.css',
              },
              ...(isImg
                ? [
                    {
                      networkRequestTime: 420,
                      networkEndTime: 870,
                      resourceType: 'Image',
                      transferSize: 20_000,
                      url,
                    },
                  ]
                : []),
            ],
          },
        },
      },
    },
  };
}

describe('page-speed-lcp-diagnostics', () => {
  it('defines all 6 monitored OgaBassey routes with expected LCP element selectors', () => {
    expect(OGABASSEY_MONITORED_CWV_ROUTES).toHaveLength(6);
    expect(OGABASSEY_MONITORED_CWV_ROUTES.map((r) => r.route)).toEqual([
      'home',
      'category',
      'brandHub',
      'familyHub',
      'pdp',
      'blogPost',
    ]);
  });

  it('computes odd, even, and empty medians accurately', () => {
    expect(computeMedian([])).toBeNull();
    expect(computeMedian([3100, 1900, 2200])).toBe(2200);
    expect(computeMedian([1800, 2000, 2400, 3000])).toBe(2200);
  });

  it('matches canonical expected selectors against class-qualified Lighthouse selectors', () => {
    expect(
      matchesExpectedSelector(
        'div.grid > picture.block > img.object-contain',
        'picture > img'
      )
    ).toBe(true);
    expect(
      matchesExpectedSelector(
        'main > div > header.space-y-3 > p.max-w-3xl',
        'header > p'
      )
    ).toBe(true);
    expect(
      matchesExpectedSelector(
        'div.col-span-3 > h2.line-clamp-3',
        'picture > img'
      )
    ).toBe(false);
    expect(
      matchesExpectedSelector(
        'header > p.intro',
        'header > p[data-cwv-lcp-copy="authority-hub"]'
      )
    ).toBe(false);
  });

  it('extracts real Lighthouse 13.3 insight node, subparts, and pre-LCP network metrics from captured PSI report', () => {
    const rawReport = JSON.parse(
      readFileSync(REAL_PSI_PDP_REPORT_PATH, 'utf8')
    );
    const diag = extractPageSpeedLcpDiagnostics(rawReport);

    expect(diag.simLcpMs).toBeCloseTo(3751.05, 1);
    expect(diag.observedLcpMs).toBe(540);
    expect(diag.lcpLoadDelayMs).toBe(2659);
    expect(diag.lcpLoadDurationMs).toBe(2882);
    expect(diag.lcpSubparts.ttfbMs).toBeCloseTo(1.801, 2);
    expect(diag.lcpSubparts.resourceLoadDelayMs).toBeCloseTo(379.898, 2);
    expect(diag.lcpElement).toContain('picture > img');
    expect(
      matchesExpectedSelector(diag.lcpElement ?? '', 'picture > img')
    ).toBe(true);
    expect(diag.lcpResourceUrl).toBe(
      'https://cdn.ogabassey.com/image/width=750,quality=30,format=auto/core-assets/products/gaming/nintendo-switch-hotel-transylvania.avif'
    );
    expect(diag.lcpResourceOrigin).toBe('https://cdn.ogabassey.com');
    expect(diag.preLcpRequestCount).toBeGreaterThan(0);
    expect(diag.preLcpBytes).toBeGreaterThan(30_000);
  });

  it('filters network requests by observed LCP cutoff and returns null when timing data is missing', () => {
    const filtered = extractPageSpeedLcpDiagnostics(
      buildMockPsiReport({
        observedLcpMs: 1000,
        networkItems: [
          {
            networkRequestTime: 10,
            resourceType: 'Document',
            transferSize: 40_000,
            url: 'https://ogabassey.com/',
          },
          {
            networkRequestTime: 2500,
            resourceType: 'Image',
            transferSize: 900_000,
            url: 'https://cdn.ogabassey.com/below-fold.avif',
          },
        ],
      })
    );
    expect(filtered.preLcpRequestCount).toBe(1);
    expect(filtered.preLcpBytes).toBe(40_000);

    const untimed = extractPageSpeedLcpDiagnostics(
      buildMockPsiReport({
        networkItems: [
          {
            resourceType: 'Document',
            transferSize: 40_000,
            url: 'https://ogabassey.com/',
          },
        ],
      })
    );
    expect(untimed.preLcpRequestCount).toBeNull();
    expect(untimed.preLcpBytes).toBeNull();
  });

  it('passes a stable 5-run series and enforces the default 150ms spread cap when omitted', () => {
    const stableRuns = [2010, 2040, 2060, 2080, 2110].map((lcpMs) =>
      extractPageSpeedLcpDiagnostics(buildMockPsiReport({ lcpMs }))
    );
    const stable = evaluatePageSpeedMultiRunSeries(stableRuns, {
      baselineMedianSimLcpMs: 2050,
      expectedLcpElement: 'picture > img',
      expectedLcpOrigin: 'https://cdn.ogabassey.com',
    });
    expect(stable.passed).toBe(true);
    expect(stable.medianSimLcpMs).toBe(2060);

    const unstableRuns = [1900, 2000, 2050, 2100, 2300].map((lcpMs) =>
      extractPageSpeedLcpDiagnostics(buildMockPsiReport({ lcpMs }))
    );
    const unstable = evaluatePageSpeedMultiRunSeries(unstableRuns);
    expect(unstable.passed).toBe(false);
    expect(unstable.alerts).toContain(
      'Simulated LCP spread 400ms exceeds 150ms stability cap'
    );
  });

  it('flags LCP element flips, fewer than 5 runs, and renders LCP diagnostics in buildPageSpeedSummary', () => {
    const flipped = [
      extractPageSpeedLcpDiagnostics(
        buildMockPsiReport({ lcpElementSelector: 'picture.block > img' })
      ),
      extractPageSpeedLcpDiagnostics(
        buildMockPsiReport({
          lcpElementSelector: 'div.col-span-3 > h2.line-clamp-3',
        })
      ),
    ];
    const summary = evaluatePageSpeedMultiRunSeries(flipped, {
      expectedLcpElement: 'picture > img',
    });
    expect(summary.passed).toBe(false);
    expect(summary.alerts).toContain(
      'Expected at least 5 runs for multi-run evaluation, received 2'
    );

    const parsed = pageSpeedTools.evaluatePageSpeedResult(
      buildMockPsiReport({})
    );
    const md = pageSpeedTools.buildPageSpeedSummary([
      {
        label: 'home',
        strategy: 'mobile',
        url: 'https://ogabassey.com/',
        ...parsed,
      },
    ]);
    expect(md).toContain('### LCP Diagnostics');
    expect(md).toContain('element `picture.block > img`');
  });
});
