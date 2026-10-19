import { describe, expect, it, vi } from 'vitest';
import { pageSpeedTools } from './run-pagespeed';

function passingPayload(runtimeError?: { code?: unknown }) {
  return {
    lighthouseResult: {
      ...(runtimeError === undefined ? {} : { runtimeError }),
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
  };
}

function stubFetch(payload: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(payload)))
  ) as unknown as typeof fetch;
}

async function auditWithPayload(payload: unknown) {
  return pageSpeedTools.runPageSpeedAudit({
    apiKey: undefined,
    baseUrl: 'https://usebaci.com',
    extraUrls: [],
    fetchImpl: stubFetch(payload),
    strategies: ['mobile'],
  });
}

describe('run-pagespeed Lighthouse runtime errors', () => {
  it('treats the Lighthouse NO_ERROR runtime code as success', async () => {
    const results = await auditWithPayload(
      passingPayload({ code: 'NO_ERROR' })
    );

    expect(results).toHaveLength(5);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.flatMap((result) => result.failures)).toHaveLength(0);
  });

  it('records genuine Lighthouse runtime errors as request failures', async () => {
    const results = await auditWithPayload(
      passingPayload({ code: 'ERRORED_DOCUMENT_REQUEST' })
    );

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.passed).toBe(false);
      expect(result.failures).toContainEqual({
        metric: 'request',
        actual: null,
        threshold: 0,
        message: 'Lighthouse runtime error: ERRORED_DOCUMENT_REQUEST',
      });
    }
  });

  it('fails closed on a present-but-unsanitizable runtime code', async () => {
    const results = await auditWithPayload(
      passingPayload({ code: 'BAD CODE!' })
    );

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.passed).toBe(false);
      expect(result.failures).toContainEqual({
        metric: 'request',
        actual: null,
        threshold: 0,
        message: 'Lighthouse runtime error: (unrecognized code format)',
      });
    }
  });
});
