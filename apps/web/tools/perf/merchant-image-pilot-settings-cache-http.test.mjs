import { describe, expect, it } from 'vitest';
import { runWithEntries } from './merchant-image-pilot-settings-cli-fixtures.mjs';

describe('merchant-image-pilot-settings cache evidence: HTTP semantics', () => {
  it('fails cached HTTP 200 responses, not just 304s', async () => {
    for (const [label, response] of Object.entries({
      disk: { fromDiskCache: true, status: 200 },
      prefetch: { fromPrefetchCache: true, status: 200 },
      serviceWorker: { fromServiceWorker: true, status: 200 },
      notModified: { status: 304 },
    })) {
      const { error, report } = await runWithEntries([response], {
        provenance: {},
      });
      expect(error, label).not.toBe(null);
      expect(report.failures.join('\n'), label).toMatch(/har\.cold-cache/);
      expect(report.failures.join('\n'), label).toMatch(/recorded cache hits/);
    }
  });

  it('fails retained disk-cache markers even with provenance', async () => {
    // HARs built with cached resources kept carry cache.beforeRequest;
    // chrome-har drops those entries by default, so a retained marker is a
    // proven warm read, never a pass.
    const { error, report } = await runWithEntries(
      [
        {
          cache: { beforeRequest: { eTag: '', hitCount: 0, lastAccess: '' } },
          response: { status: 200 },
        },
      ],
      { provenance: {} }
    );
    expect(error).not.toBe(null);
    expect(report.failures.join('\n')).toMatch(/har\.cold-cache/);
  });

  it('passes attested uncached runs without misclassifying 204s', async () => {
    const { error, report } = await runWithEntries(
      [{ status: 200 }, { status: 204 }, { status: 200 }],
      { provenance: {} }
    );
    expect(error).toBe(null);
    expect(report.ok).toBe(true);
    expect(
      report.checks.some((check) => check.name === 'har.cold-cache' && check.ok)
    ).toBe(true);
  });

  it('fails the cold claim without cache provenance, passes with it', async () => {
    // Zero recorded hits alone cannot prove cold: converters may omit
    // cached resources entirely, so absence without provenance fails.
    const unknown = await runWithEntries([{ status: 200 }]);
    expect(unknown.error).not.toBe(null);
    expect(unknown.report.ok).toBe(false);
    expect(unknown.report.failures.join('\n')).toMatch(/har\.cold-cache/);
    expect(unknown.report.failures.join('\n')).toMatch(/provenance/);
    expect(unknown.report.warnings.join('\n')).toMatch(
      /har\.cache-provenance: unknown/
    );
    const attested = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=154.0.0.0'],
      provenance: {},
    });
    expect(attested.error).toBe(null);
    expect(attested.report.warnings).toEqual([]);
    expect(
      attested.report.checks.some(
        (check) => check.name === 'har.cache-provenance' && check.ok
      )
    ).toBe(true);
    expect(attested.report.recorded.cacheProvenance).toBe(
      'browsertime@2026-10-04T00:09:00.000Z'
    );
  });
});
