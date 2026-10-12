import { describe, expect, it } from 'vitest';
import {
  ROUTE,
  runWithEntries,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';

describe('merchant-image-pilot-settings cache evidence: provenance binding', () => {
  it('rejects caller strings, stale resets, and undated runs', async () => {
    // A bare caller string is a path that cannot be read — never evidence.
    const bogus = await runWithEntries([{ status: 200 }], {
      provenance: 'browsertime-fresh-profile-default',
    });
    expect(bogus.error).not.toBe(null);
    expect(bogus.report.failures.join('\n')).toMatch(/cannot read/);
    // Malformed bytes fail closed.
    const malformed = await runWithEntries([{ status: 200 }], {
      provenanceRaw: '{not-json',
    });
    expect(malformed.error).not.toBe(null);
    expect(malformed.report.failures.join('\n')).toMatch(/not valid JSON/);
    // A reset from the previous evening cannot certify this run cold.
    const stale = await runWithEntries([{ status: 200 }], {
      provenance: { resetAt: '2026-10-03T22:00:00.000Z' },
    });
    expect(stale.error).not.toBe(null);
    expect(stale.report.failures.join('\n')).toMatch(/stale/);
    // Undated HAR pages cannot bind the reset to the run.
    const undated = await runWithEntries([{ status: 200 }], {
      pages: [
        {
          _meta: { connectivity: 'native', runId: 'run-navigation-1' },
          _url: ROUTE,
          title: 'u run 1',
        },
      ],
      provenance: {},
    });
    expect(undated.error).not.toBe(null);
    expect(undated.report.failures.join('\n')).toMatch(/no startedDateTime/);
  });

  it('requires the screenshot to bind to the measured HAR navigation', async () => {
    // A stale DPR-2 screenshot from another iteration must not certify
    // this HAR: unbound, foreign-run, byte-mismatched, and stale
    // captures all fail the geometry gate.
    const missing = await runWithEntries([{ status: 200 }], {
      provenance: {},
      shot: false,
    });
    expect(missing.error).not.toBe(null);
    expect(missing.report.failures.join('\n')).toMatch(/har\.geometry/);
    expect(missing.report.failures.join('\n')).toMatch(
      /no screenshot provenance/
    );
    const foreign = await runWithEntries([{ status: 200 }], {
      provenance: {},
      shot: { runId: 'run-navigation-2' },
    });
    expect(foreign.error).not.toBe(null);
    expect(foreign.report.failures.join('\n')).toMatch(
      /does not match the measured navigation/
    );
    const swapped = await runWithEntries([{ status: 200 }], {
      provenance: {},
      shot: { screenshotSha256: '0'.repeat(64) },
    });
    expect(swapped.error).not.toBe(null);
    expect(swapped.report.failures.join('\n')).toMatch(
      /does not match the supplied screenshot bytes/
    );
    const stale = await runWithEntries([{ status: 200 }], {
      provenance: {},
      shot: { capturedAt: '2026-10-04T02:30:00.000Z' },
    });
    expect(stale.error).not.toBe(null);
    expect(stale.report.failures.join('\n')).toMatch(/stale/);
    const bogus = await runWithEntries([{ status: 200 }], {
      provenance: {},
      shot: 'browsertime-screenshot-default',
    });
    expect(bogus.error).not.toBe(null);
    expect(bogus.report.failures.join('\n')).toMatch(/cannot read/);
    const bound = await runWithEntries([{ status: 200 }], {
      provenance: {},
    });
    expect(bound.error).toBe(null);
    expect(bound.report.ok).toBe(true);
    expect(bound.report.recorded.screenshotProvenance).toBe(
      'browsertime@2026-10-04T00:10:30.000Z'
    );
  });

  it('records the attested browser executable separately from the emulated UA', async () => {
    const unknown = await runWithEntries([{ status: 200 }]);
    expect(unknown.report.warnings.join('\n')).toMatch(
      /har\.browser-version: unknown/
    );
    const attested = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=154.0.0.0'],
      provenance: {},
    });
    expect(attested.error).toBe(null);
    expect(attested.report.warnings).toEqual([]);
    expect(attested.report.recorded.browserExecutable).toBe('154.0.0.0');
    const wrongMajor = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=153.0.0.0'],
      provenance: {},
    });
    expect(wrongMajor.error).not.toBe(null);
    expect(wrongMajor.report.failures.join('\n')).toMatch(
      /har\.browser-version/
    );
    const malformed = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=debian-chromium'],
      provenance: {},
    });
    expect(malformed.error).not.toBe(null);
  });
});
