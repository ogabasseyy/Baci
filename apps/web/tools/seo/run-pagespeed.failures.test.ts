import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageSpeedTools } from './run-pagespeed';

describe('run-pagespeed failures', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('records per-target request failures instead of aborting the full audit run', async () => {
    const fetchImpl: typeof fetch = vi.fn(() => {
      const callCount = vi.mocked(fetchImpl).mock.calls.length;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                status: 'INVALID_ARGUMENT',
                message: 'API key should-not-be-logged is invalid',
                errors: [{ reason: 'badRequest' }],
                details: [{ reason: 'API_KEY_INVALID' }],
              },
            }),
            {
              status: 400,
            }
          )
        );
      }
      return Promise.resolve(
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
    });

    const results = await pageSpeedTools.runPageSpeedAudit({
      apiKey: undefined,
      baseUrl: 'https://usebaci.com',
      extraUrls: [],
      fetchImpl,
      strategies: ['mobile'],
    });

    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      label: 'home',
      passed: false,
      failures: [
        {
          metric: 'request',
          message:
            'PageSpeed Insights request failed for https://usebaci.com/ (mobile) with status 400; API status INVALID_ARGUMENT; reasons badRequest, API_KEY_INVALID',
        },
      ],
    });
    expect(results[0]?.failures[0]?.message).not.toContain(
      'should-not-be-logged'
    );
    expect(results.slice(1).every((result) => result.passed)).toBe(true);
  });

  it('records timeout failures without aborting the remaining audits', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PAGE_SPEED_TIMEOUT_MS', '100');
    const fetchImpl: typeof fetch = vi.fn((input, init) => {
      const callCount = vi.mocked(fetchImpl).mock.calls.length;
      if (callCount > 1) {
        return Promise.resolve(
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
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException(`aborted ${String(input)}`, 'AbortError'));
        });
      });
    });

    const pendingAudit = pageSpeedTools.runPageSpeedAudit({
      apiKey: undefined,
      baseUrl: 'https://usebaci.com',
      extraUrls: [],
      fetchImpl,
      strategies: ['mobile'],
    });

    await vi.advanceTimersByTimeAsync(100);

    const results = await pendingAudit;
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      label: 'home',
      passed: false,
      failures: [
        {
          metric: 'request',
          message: expect.stringContaining(
            'PageSpeed Insights request timed out for https://usebaci.com/ (mobile)'
          ),
        },
      ],
    });
    expect(results.slice(1).every((result) => result.passed)).toBe(true);
  });

  it('falls back to an omitted-count message for non-token audit IDs', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: {
                performance: {
                  score: 0.5,
                  auditRefs: [{ id: 'weird/id', weight: 1 }],
                },
                accessibility: { score: 0.99 },
                seo: { score: 0.98 },
                'best-practices': { score: 0.95 },
              },
              audits: {
                'weird/id': { score: 0 },
                'largest-contentful-paint': { numericValue: 1800 },
                'cumulative-layout-shift': { numericValue: 0.04 },
                'total-blocking-time': { numericValue: 90 },
                'interaction-to-next-paint': { numericValue: 180 },
              },
            },
          })
        )
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
    for (const result of results) {
      expect(result.passed).toBe(false);
      expect(result.failures).toContainEqual({
        metric: 'performance',
        actual: 0.5,
        threshold: 0.87,
        message: 'Failing Lighthouse audits: 1 omitted (unexpected ID format)',
      });
    }
  });
});
