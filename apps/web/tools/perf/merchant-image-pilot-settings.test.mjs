import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

// Real encodings: the gate fully validates PNG structure, so header-only
// fakes no longer pass har.geometry.
function pngBuffer(width, height) {
  return sharp({
    create: { background: '#ffffff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}

async function provenanceArg(dir, overrides = {}) {
  const path = join(dir, `reset-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(
    path,
    JSON.stringify({
      event: 'profile-reset',
      freshProfile: true,
      profileDir: join(dir, 'profile'),
      resetAt: '2026-10-04T00:09:00.000Z',
      runId: 'run-navigation-1',
      tool: 'browsertime',
      ...overrides,
    })
  );
  return `--cache-provenance=${path}`;
}

const DATED_PAGE = {
  _meta: { connectivity: 'native', runId: 'run-navigation-1' },
  startedDateTime: '2026-10-04T00:10:00.000Z',
  title: 'u run 1',
};

describe('merchant-image-pilot-settings gate', () => {
  it('fails closed on mismatched effective settings', async () => {
    // End-to-end through the CLI: a natively-shaped HAR must fail a 4G
    // expectation, and a DPR-1.75 report must fail a DPR-2 expectation.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    const lhPath = join(dir, 'report.json');
    const provenance = await provenanceArg(dir);
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                headers: [
                  { name: 'User-Agent', value: 'X Chrome/154.0.0.0 Y' },
                ],
              },
              response: { status: 200 },
            },
          ],
          pages: [{ ...DATED_PAGE }],
        },
      })
    );
    await writeFile(pngPath, await pngBuffer(750, 1334));
    await writeFile(
      lhPath,
      JSON.stringify({
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: false,
            height: 823,
            mobile: true,
            width: 412,
          },
          throttling: { cpuSlowdownMultiplier: 4 },
          throttlingMethod: 'simulate',
        },
        environment: {},
      })
    );
    const { execFile } = await import('node:child_process');
    const run = (extra) =>
      new Promise((resolve) => {
        execFile(
          process.execPath,
          [
            join(
              // @ts-expect-error import.meta.dirname is provided by vitest.
              import.meta.dirname,
              'merchant-image-pilot-settings.mjs'
            ),
            `--har=${harPath}`,
            `--screenshot=${pngPath}`,
            ...extra,
          ],
          (error, stdout) => resolve({ error, stdout })
        );
      });
    const mismatched = await run([
      `--lighthouse=${lhPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=4G',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-lh-viewport=412x823',
      '--expect-lh-dpr=2',
      '--expect-cpu-slowdown=4',
    ]);
    expect(mismatched.error).not.toBe(null);
    expect(mismatched.stdout).toMatch(/har\.connectivity/);
    expect(mismatched.stdout).toMatch(/lighthouse\.dpr/);
    const harOnly = await run([
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
    ]);
    expect(harOnly.error).toBe(null);
    expect(harOnly.stdout).toMatch(/lighthouse\.skipped/);
    // ±2px DPR rounding passes (750x1334 fixture vs 375x668@2 = 750x1336),
    // but a wrong DPR still fails.
    const rounded = await run([
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x668',
      '--expect-dpr=2',
      provenance,
    ]);
    expect(rounded.error).toBe(null);
    const wrongDpr = await run([
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=3',
    ]);
    expect(wrongDpr.error).not.toBe(null);
    expect(wrongDpr.stdout).toMatch(/har\.geometry/);
    // A zero iteration count fails closed instead of passing an empty
    // HAR vacuously.
    const zeroIterations = await run([
      '--expect-iterations=0',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
    ]);
    expect(zeroIterations.error).not.toBe(null);
    expect(zeroIterations.stdout).toMatch(/bad --expect-iterations/);
    const matched = await run([
      `--lighthouse=${lhPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-lh-viewport=412x823',
      '--expect-lh-dpr=1.75',
      '--expect-cpu-slowdown=4',
    ]);
    expect(mismatched.stdout).not.toBe(matched.stdout);
    expect(matched.error).toBe(null);
    expect(JSON.parse(matched.stdout).ok).toBe(true);
    // Dormant geometry never certifies a viewport: disabled emulation and
    // a wrong mobile mode fail even when width/height/DPR all match.
    const lhArgs = [
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-lh-viewport=412x823',
      '--expect-lh-dpr=1.75',
      '--expect-cpu-slowdown=4',
    ];
    const lhDisabled = join(dir, 'report-disabled.json');
    await writeFile(
      lhDisabled,
      JSON.stringify({
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: true,
            height: 823,
            mobile: true,
            width: 412,
          },
          throttling: { cpuSlowdownMultiplier: 4 },
          throttlingMethod: 'simulate',
        },
        environment: {},
      })
    );
    const disabled = await run([`--lighthouse=${lhDisabled}`, ...lhArgs]);
    expect(disabled.error).not.toBe(null);
    expect(disabled.stdout).toMatch(/lighthouse\.screen-emulation/);
    const lhDesktop = join(dir, 'report-desktop-mode.json');
    await writeFile(
      lhDesktop,
      JSON.stringify({
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: false,
            height: 823,
            mobile: false,
            width: 412,
          },
          throttling: { cpuSlowdownMultiplier: 4 },
          throttlingMethod: 'simulate',
        },
        environment: {},
      })
    );
    const wrongMode = await run([`--lighthouse=${lhDesktop}`, ...lhArgs]);
    expect(wrongMode.error).not.toBe(null);
    expect(wrongMode.stdout).toMatch(/lighthouse\.emulation-mode/);
  });
  describe('merchant-image-pilot-settings cache evidence', () => {
    async function runWithEntries(
      entries,
      { extra = [], pages, provenance, provenanceRaw } = {}
    ) {
      const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-cache-'));
      const harPath = join(dir, 'browsertime.har');
      const pngPath = join(dir, 'shot.png');
      await writeFile(
        harPath,
        JSON.stringify({
          log: {
            entries: entries.map((item) => {
              // Plain response object, or { cache, response } for retained
              // disk-cache markers.
              const shaped =
                item && typeof item === 'object' && 'response' in item
                  ? item
                  : { response: item };
              return {
                ...(shaped.cache === undefined ? {} : { cache: shaped.cache }),
                request: {
                  headers: [
                    {
                      name: 'User-Agent',
                      value: 'X Chrome/154.0.0.0 Y',
                    },
                  ],
                },
                response: shaped.response,
              };
            }),
            pages: pages ?? [{ ...DATED_PAGE }],
          },
        })
      );
      await writeFile(pngPath, await pngBuffer(750, 1334));
      // Provenance is a runner artifact file: {} writes a valid one bound
      // to the dated pages, a string passes through literally (bogus
      // paths), and provenanceRaw writes non-JSON bytes.
      const provenanceArgs = [];
      if (typeof provenance === 'string') {
        provenanceArgs.push(`--cache-provenance=${provenance}`);
      } else if (provenance !== undefined) {
        provenanceArgs.push(await provenanceArg(dir, provenance));
      }
      if (provenanceRaw !== undefined) {
        const rawPath = join(dir, 'reset-raw.json');
        await writeFile(rawPath, provenanceRaw);
        provenanceArgs.push(`--cache-provenance=${rawPath}`);
      }
      const { execFile } = await import('node:child_process');
      const report = await new Promise((resolve) => {
        execFile(
          process.execPath,
          [
            join(
              // @ts-expect-error import.meta.dirname is provided by vitest.
              import.meta.dirname,
              'merchant-image-pilot-settings.mjs'
            ),
            `--har=${harPath}`,
            `--screenshot=${pngPath}`,
            '--expect-iterations=1',
            '--expect-connectivity=native',
            '--expect-chrome-major=154',
            '--expect-viewport=375x667',
            '--expect-dpr=2',
            ...extra,
            ...provenanceArgs,
          ],
          (error, stdout) => resolve({ error, report: JSON.parse(stdout) })
        );
      });
      return report;
    }

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
        expect(report.failures.join('\n'), label).toMatch(
          /recorded cache hits/
        );
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
        report.checks.some(
          (check) => check.name === 'har.cold-cache' && check.ok
        )
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
            title: 'u run 1',
          },
        ],
        provenance: {},
      });
      expect(undated.error).not.toBe(null);
      expect(undated.report.failures.join('\n')).toMatch(/no startedDateTime/);
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
  it('rejects a non-numeric expected DPR at the CLI instead of passing geometry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-dpr-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [],
          pages: [{ _meta: { connectivity: 'native' }, title: 'u run 1' }],
        },
      })
    );
    await writeFile(pngPath, await pngBuffer(750, 1334));
    const { execFile } = await import('node:child_process');
    const { error, stdout } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          join(
            // @ts-expect-error import.meta.dirname is provided by vitest.
            import.meta.dirname,
            'merchant-image-pilot-settings.mjs'
          ),
          `--har=${harPath}`,
          `--screenshot=${pngPath}`,
          '--expect-iterations=1',
          '--expect-connectivity=native',
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=abc',
          '--cache-provenance=test-fresh-profile',
        ],
        (execError, execStdout) =>
          resolve({ error: execError, stdout: execStdout })
      );
    });
    expect(error).not.toBe(null);
    expect(stdout).toMatch(/bad --expect-dpr/);
    expect(JSON.parse(stdout).ok).toBe(false);
  });
});
