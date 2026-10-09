import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageSpeedTools } from './run-pagespeed';

describe('run-pagespeed', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('flags threshold breaches in the parsed report', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      lighthouseResult: {
        categories: {
          performance: { score: 0.72 },
          accessibility: { score: 0.95 },
          seo: { score: 0.81 },
          'best-practices': { score: 0.86 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 3200 },
          'cumulative-layout-shift': { numericValue: 0.12 },
          'total-blocking-time': { numericValue: 180 },
          'interaction-to-next-paint': { numericValue: 260 },
        },
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.metric)).toEqual([
      'performance',
      'seo',
      'best-practices',
      'lcp',
      'cls',
      'inp',
    ]);
    expect(result.vitals.inp).toBe(260);
  });

  it('prefers field INP from CrUX data and enforces the 200ms threshold', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      loadingExperience: {
        metrics: {
          INTERACTION_TO_NEXT_PAINT: { percentile: 240 },
        },
      },
      lighthouseResult: {
        categories: {
          performance: { score: 0.92 },
          accessibility: { score: 0.99 },
          seo: { score: 0.98 },
          'best-practices': { score: 0.95 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 1800 },
          'cumulative-layout-shift': { numericValue: 0.04 },
          'total-blocking-time': { numericValue: 90 },
          'interaction-to-next-paint': { numericValue: 400 },
        },
      },
    });

    expect(result.failures).toContainEqual({
      metric: 'inp',
      actual: 240,
      threshold: 200,
    });
    expect(result.vitals.inp).toBe(240);
  });

  it('falls back to lab INP when CrUX data is unavailable', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      lighthouseResult: {
        categories: {
          performance: { score: 0.92 },
          accessibility: { score: 0.99 },
          seo: { score: 0.98 },
          'best-practices': { score: 0.95 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 1800 },
          'cumulative-layout-shift': { numericValue: 0.04 },
          'total-blocking-time': { numericValue: 90 },
          'interaction-to-next-paint': { numericValue: 240 },
        },
      },
    });

    expect(result.failures).toContainEqual({
      metric: 'inp',
      actual: 240,
      threshold: 200,
    });
    expect(result.vitals.inp).toBe(240);
  });

  it('uses TBT as the lab responsiveness gate when INP is unavailable', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      lighthouseResult: {
        categories: {
          performance: { score: 0.92 },
          accessibility: { score: 0.99 },
          seo: { score: 0.98 },
          'best-practices': { score: 0.95 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 1800 },
          'cumulative-layout-shift': { numericValue: 0.04 },
          'total-blocking-time': { numericValue: 90 },
        },
      },
    });

    expect(result.passed).toBe(true);
    expect(result.failures).not.toContainEqual(
      expect.objectContaining({ metric: 'inp' })
    );
    expect(result.vitals.inp).toBeNull();
  });

  it('runs the audit across targets and strategies using the provided fetch', async () => {
    const fetchImpl: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: {
                performance: { score: 0.92 },
                accessibility: { score: 0.99 },
                seo: { score: 0.98 },
                'best-practices': { score: 0.95 },
              },
              audits: {
                'largest-contentful-paint': { numericValue: 1800 },
                'cumulative-layout-shift': { numericValue: 0.04 },
                'total-blocking-time': { numericValue: 90 },
                'interaction-to-next-paint': { numericValue: 180 },
              },
            },
          })
        )
    );

    const results = await pageSpeedTools.runPageSpeedAudit({
      apiKey: undefined,
      baseUrl: 'https://usebaci.com',
      extraUrls: [],
      fetchImpl,
      strategies: ['mobile'],
    });

    expect(results).toHaveLength(5);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe('PageSpeed blocked-page diagnostics', () => {
  it('names failing weighted audits without relaxing the SEO threshold', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      lighthouseResult: {
        categories: {
          seo: {
            score: 0.8,
            auditRefs: [
              { id: 'http-status-code', weight: 1 },
              { id: 'is-crawlable', weight: 1 },
              { id: 'manual-check', weight: 0 },
            ],
          },
        },
        audits: {
          'http-status-code': { score: 0 },
          'is-crawlable': { score: 0 },
          'manual-check': { score: 0 },
        },
      },
    });
    expect(result.failures).toContainEqual({
      metric: 'seo',
      actual: 0.8,
      threshold: 0.9,
      message: 'Failing Lighthouse audits: http-status-code, is-crawlable',
    });
    expect(result.passed).toBe(false);
  });

  it('reports a Lighthouse runtime error separately from missing scores', () => {
    const result = pageSpeedTools.evaluatePageSpeedResult({
      lighthouseResult: { runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST' } },
    });
    expect(result.failures).toContainEqual({
      metric: 'request',
      actual: null,
      threshold: 0,
      message: 'Lighthouse runtime error: ERRORED_DOCUMENT_REQUEST',
    });
    expect(result.passed).toBe(false);
  });
});
