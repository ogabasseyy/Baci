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

  it('requires run-bound browser executable provenance, not caller text', async () => {
    // Absent launch record: the emulated request UA cannot prove the
    // executable, so the gate fails instead of warning unknown.
    const missing = await runWithEntries([{ status: 200 }], {
      browser: false,
      provenance: {},
    });
    expect(missing.error).not.toBe(null);
    expect(missing.report.failures.join('\n')).toMatch(
      /har\.browser-version: no runner\/CDP executable provenance/
    );
    // Valid launch: the recorded executable comes from run evidence.
    const bound = await runWithEntries([{ status: 200 }], {
      provenance: {},
    });
    expect(bound.error).toBe(null);
    expect(bound.report.ok).toBe(true);
    expect(bound.report.recorded.browserExecutable).toBe('154.0.0.0');
    // Older-Chrome run: same UA shape, wrong executable major.
    const wrongMajor = await runWithEntries([{ status: 200 }], {
      browser: { executableVersion: '153.0.0.0' },
      provenance: {},
    });
    expect(wrongMajor.error).not.toBe(null);
    expect(wrongMajor.report.failures.join('\n')).toMatch(
      /har\.browser-version: attested executable 153\.0\.0\.0 does not match Chrome 154/
    );
    // Unbound launch: runId, staleness, and shape all refuse.
    for (const [label, browser, pattern] of [
      ['runId', { runId: 'run-other' }, /runId does not match/],
      ['stale', { launchedAt: '2026-10-03T00:09:30.000Z' }, /launch is stale/],
      [
        'postdated',
        { launchedAt: '2026-10-04T01:09:30.000Z' },
        /postdates the measured run/,
      ],
      [
        'malformed',
        { executableVersion: 'debian-chromium' },
        /not a dotted browser build/,
      ],
    ]) {
      const unbound = await runWithEntries([{ status: 200 }], {
        browser,
        provenance: {},
      });
      expect(unbound.error, label).not.toBe(null);
      expect(unbound.report.failures.join('\n'), label).toMatch(pattern);
    }
    // The --browser-version flag survives only as a cross-check: a
    // contradiction with the run evidence fails, a match passes.
    const contradicting = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=153.0.0.0'],
      provenance: {},
    });
    expect(contradicting.error).not.toBe(null);
    expect(contradicting.report.failures.join('\n')).toMatch(
      /contradicts the run-bound executable/
    );
    const matching = await runWithEntries([{ status: 200 }], {
      extra: ['--browser-version=154.0.0.0'],
      provenance: {},
    });
    expect(matching.error).toBe(null);
    expect(matching.report.ok).toBe(true);
  });
});
