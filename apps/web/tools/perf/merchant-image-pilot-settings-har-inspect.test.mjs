import { describe, expect, it } from 'vitest';
import { inspectHarRecording } from './merchant-image-pilot-settings-har-inspect.mjs';

describe('merchant-image-pilot-settings-har-inspect', () => {
  it('extracts the browser UA and classifies cache hits', () => {
    const ua = 'Mozilla/5.0 Chrome/154.0.0.0 Mobile Safari/537.36';
    const result = inspectHarRecording(
      {
        log: {
          entries: [
            {
              request: { headers: [{ name: 'User-Agent', value: ua }] },
              response: { status: 200 },
            },
            { response: { status: 204 } },
            { response: { fromDiskCache: true, status: 200 } },
            { response: { status: 304 } },
          ],
          pages: [{ _meta: { connectivity: 'native' } }],
        },
      },
      { expectConnectivity: 'native', expectIterations: 1 }
    );
    expect(result.userAgent).toBe(ua);
    expect(result.cacheHits).toHaveLength(2);
    expect(result.iterationsCheck).toEqual({ ok: true });
    expect(result.connectivityCheck).toEqual({ ok: true });
  });

  it('reports iteration and connectivity mismatches', () => {
    const result = inspectHarRecording(
      {
        log: {
          entries: [],
          pages: [{ _meta: { connectivity: 'native' } }],
        },
      },
      { expectConnectivity: '4G', expectIterations: 2 }
    );
    expect(result.userAgent).toBeNull();
    expect(result.iterationsCheck.ok).toBe(false);
    expect(result.connectivityCheck.error).toMatch(
      /recorded native, expected 4G/
    );
  });
});
