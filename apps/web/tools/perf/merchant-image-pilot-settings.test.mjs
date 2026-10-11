import { createHash } from 'node:crypto';
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

const ROUTE = 'http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot';

const DATED_PAGE = {
  _meta: { connectivity: 'native', runId: 'run-navigation-1' },
  _url: ROUTE,
  startedDateTime: '2026-10-04T00:10:00.000Z',
  title: 'u run 1',
};

async function screenshotProvenanceArg(dir, pngBytes, overrides = {}) {
  const path = join(dir, `shot-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(
    path,
    JSON.stringify({
      capturedAt: '2026-10-04T00:10:30.000Z',
      deviceScaleFactor: 2,
      event: 'screenshot-capture',
      runId: 'run-navigation-1',
      screenshotSha256: createHash('sha256').update(pngBytes).digest('hex'),
      tool: 'browsertime',
      viewport: { height: 667, width: 375 },
      ...overrides,
    })
  );
  return `--screenshot-provenance=${path}`;
}

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
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(pngPath, pngBytes);
    const shot = await screenshotProvenanceArg(dir, pngBytes);
    await writeFile(
      lhPath,
      JSON.stringify({
        finalDisplayedUrl: ROUTE,
        requestedUrl: ROUTE,
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: false,
            height: 823,
            mobile: true,
            width: 412,
          },
          throttling: {
            cpuSlowdownMultiplier: 4,
            rttMs: 150,
            throughputKbps: 1638.4,
          },
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
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-rtt-ms=150',
      '--expect-throughput-kbps=1638.4',
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
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      shot,
    ]);
    expect(harOnly.error).toBe(null);
    expect(harOnly.stdout).toMatch(/lighthouse\.skipped/);
    // ±2px DPR rounding passes (750x1334 fixture vs 375x668@2 = 750x1336),
    // but a wrong DPR still fails. The provenance pair is exact (recorded
    // configuration has no rounding), so the rounded expectation carries
    // matching provenance.
    const shot668 = await screenshotProvenanceArg(dir, pngBytes, {
      viewport: { height: 668, width: 375 },
    });
    const rounded = await run([
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x668',
      '--expect-dpr=2',
      provenance,
      shot668,
    ]);
    expect(rounded.error).toBe(null);
    const wrongDpr = await run([
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
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
      `--expect-route=${ROUTE}`,
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
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      shot,
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-rtt-ms=150',
      '--expect-throughput-kbps=1638.4',
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
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      shot,
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-rtt-ms=150',
      '--expect-throughput-kbps=1638.4',
      '--expect-lh-viewport=412x823',
      '--expect-lh-dpr=1.75',
      '--expect-cpu-slowdown=4',
    ];
    const lhDisabled = join(dir, 'report-disabled.json');
    await writeFile(
      lhDisabled,
      JSON.stringify({
        finalDisplayedUrl: ROUTE,
        requestedUrl: ROUTE,
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: true,
            height: 823,
            mobile: true,
            width: 412,
          },
          throttling: {
            cpuSlowdownMultiplier: 4,
            rttMs: 150,
            throughputKbps: 1638.4,
          },
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
        finalDisplayedUrl: ROUTE,
        requestedUrl: ROUTE,
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            disabled: false,
            height: 823,
            mobile: false,
            width: 412,
          },
          throttling: {
            cpuSlowdownMultiplier: 4,
            rttMs: 150,
            throughputKbps: 1638.4,
          },
          throttlingMethod: 'simulate',
        },
        environment: {},
      })
    );
    const wrongMode = await run([`--lighthouse=${lhDesktop}`, ...lhArgs]);
    expect(wrongMode.error).not.toBe(null);
    expect(wrongMode.stdout).toMatch(/lighthouse\.emulation-mode/);
  });

  it('rejects a same-product viewport/DPR pair from provenance', async () => {
    // PNG pixels only prove viewport×DPR: a 750x1334 screenshot satisfies
    // both 375x667@2 and 750x1334@1, so the product check passes while the
    // run profile is wrong. The runner-recorded pair breaks the tie —
    // each compared independently, exactly.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-pair-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
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
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(pngPath, pngBytes);
    const shotWrongPair = await screenshotProvenanceArg(dir, pngBytes, {
      deviceScaleFactor: 1,
      viewport: { height: 1334, width: 750 },
    });
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
          `--expect-route=${ROUTE}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=2',
          provenance,
          shotWrongPair,
        ],
        (execError, execStdout) =>
          resolve({ error: execError, stdout: execStdout })
      );
    });
    expect(error).not.toBe(null);
    expect(stdout).toMatch(
      /provenance viewport 750x1334 is not expected 375x667/
    );
    expect(stdout).toMatch(/provenance deviceScaleFactor 1 is not expected 2/);
  });

  it('matches the recorded Lighthouse network profile, not just the method', async () => {
    // Same method + CPU on both runs, different network profiles: without
    // recorded RTT/throughput comparison a slow control run and a native
    // pilot run would certify as matched evidence.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-lh-net-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
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
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(pngPath, pngBytes);
    const reportFor = (throttling, throttlingMethod = 'simulate') =>
      JSON.stringify({
        finalDisplayedUrl: ROUTE,
        requestedUrl: ROUTE,
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 2,
            disabled: false,
            height: 667,
            mobile: true,
            width: 375,
          },
          throttling,
          throttlingMethod,
        },
        environment: {},
      });
    const { execFile } = await import('node:child_process');
    const runLh = (lhBody, extra) =>
      new Promise((resolve) => {
        const lhPath = join(
          dir,
          `report-${Math.random().toString(36).slice(2)}.json`
        );
        writeFile(lhPath, lhBody).then(() =>
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
              `--lighthouse=${lhPath}`,
              '--expect-iterations=1',
              '--expect-connectivity=native',
              `--expect-route=${ROUTE}`,
              '--expect-chrome-major=154',
              '--expect-viewport=375x667',
              '--expect-dpr=2',
              '--expect-form-factor=mobile',
              '--expect-lh-viewport=375x667',
              '--expect-lh-dpr=2',
              '--expect-cpu-slowdown=4',
              ...extra,
            ],
            (error, stdout) => resolve({ error, stdout })
          )
        );
      });
    const provenance = await provenanceArg(dir);
    const shot = await screenshotProvenanceArg(dir, pngBytes);
    const base = [provenance, shot, '--expect-throttling-method=simulate'];
    // Matched simulate profile passes.
    const matched = await runLh(
      reportFor({ cpuSlowdownMultiplier: 4, rttMs: 150, throughputKbps: 1000 }),
      [...base, '--expect-rtt-ms=150', '--expect-throughput-kbps=1000']
    );
    expect(matched.error).toBe(null);
    // Same method, different RTT: control on slow networking vs pilot on
    // near-native values must not certify as matched.
    const slowRtt = await runLh(
      reportFor({ cpuSlowdownMultiplier: 4, rttMs: 562, throughputKbps: 1000 }),
      [...base, '--expect-rtt-ms=150', '--expect-throughput-kbps=1000']
    );
    expect(slowRtt.error).not.toBe(null);
    expect(slowRtt.stdout).toMatch(/lighthouse\.throttling-rtt-ms/);
    const fastNet = await runLh(
      reportFor({ cpuSlowdownMultiplier: 4, rttMs: 150, throughputKbps: 9000 }),
      [...base, '--expect-rtt-ms=150', '--expect-throughput-kbps=1000']
    );
    expect(fastNet.error).not.toBe(null);
    expect(fastNet.stdout).toMatch(/lighthouse\.throttling-throughput-kbps/);
    // Missing network expectations are a usage error, not a silent skip.
    const unpinned = await runLh(
      reportFor({ cpuSlowdownMultiplier: 4, rttMs: 150, throughputKbps: 1000 }),
      base
    );
    expect(unpinned.error).not.toBe(null);
    expect(unpinned.stdout).toMatch(/missing --expect-rtt-ms/);
    // Devtools runs compare their own recorded fields.
    const devtoolsBase = [
      provenance,
      shot,
      '--expect-throttling-method=devtools',
    ];
    const devtools = await runLh(
      reportFor(
        {
          cpuSlowdownMultiplier: 4,
          downloadThroughputKbps: 1600,
          requestLatencyMs: 0,
          uploadThroughputKbps: 750,
        },
        'devtools'
      ),
      [
        ...devtoolsBase,
        '--expect-request-latency-ms=0',
        '--expect-download-kbps=1600',
        '--expect-upload-kbps=750',
      ]
    );
    expect(devtools.error).toBe(null);
    const devtoolsDrift = await runLh(
      reportFor(
        {
          cpuSlowdownMultiplier: 4,
          downloadThroughputKbps: 1600,
          requestLatencyMs: 90,
          uploadThroughputKbps: 750,
        },
        'devtools'
      ),
      [
        ...devtoolsBase,
        '--expect-request-latency-ms=0',
        '--expect-download-kbps=1600',
        '--expect-upload-kbps=750',
      ]
    );
    expect(devtoolsDrift.error).not.toBe(null);
    expect(devtoolsDrift.stdout).toMatch(
      /lighthouse\.throttling-request-latency-ms/
    );
    // Methods with no comparable recorded profile fail closed.
    const provided = await runLh(
      reportFor({ cpuSlowdownMultiplier: 4 }, 'provided'),
      [provenance, shot, '--expect-throttling-method=provided']
    );
    expect(provided.error).not.toBe(null);
    expect(provided.stdout).toMatch(/lighthouse\.throttling-network/);
  });
  describe('merchant-image-pilot-settings cache evidence', () => {
    async function runWithEntries(
      entries,
      { extra = [], pages, provenance, provenanceRaw, shot = {}, shotRaw } = {}
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
      const shotBytes = await pngBuffer(750, 1334);
      await writeFile(pngPath, shotBytes);
      // Provenance is a runner artifact file: {} writes a valid one bound
      // to the dated pages, a string passes through literally (bogus
      // paths), and provenanceRaw writes non-JSON bytes. Screenshots bind
      // by default (the geometry gate requires it); shot:false omits the
      // binding for the missing-provenance case.
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
      if (typeof shot === 'string') {
        provenanceArgs.push(`--screenshot-provenance=${shot}`);
      } else if (shot !== false) {
        provenanceArgs.push(
          await screenshotProvenanceArg(dir, shotBytes, shot ?? {})
        );
      }
      if (shotRaw !== undefined) {
        const rawPath = join(dir, 'shot-raw.json');
        await writeFile(rawPath, shotRaw);
        provenanceArgs.push(`--screenshot-provenance=${rawPath}`);
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
            `--expect-route=${ROUTE}`,
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
  it('rejects a non-numeric expected DPR at the CLI instead of passing geometry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-dpr-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [],
          pages: [
            {
              _meta: { connectivity: 'native' },
              _url: ROUTE,
              title: 'u run 1',
            },
          ],
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
          `--expect-route=${ROUTE}`,
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

describe('merchant-image-pilot-settings route and artifact bounds', () => {
  const UA_ENTRY = {
    request: {
      headers: [{ name: 'User-Agent', value: 'X Chrome/154.0.0.0 Y' }],
    },
    response: { status: 200 },
  };

  function harWithPages(pages) {
    return { log: { entries: [structuredClone(UA_ENTRY)], pages } };
  }

  async function runGate(harJson, extra = [], route = ROUTE) {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-route-'));
    const harPath = join(dir, 'run.har');
    const pngPath = join(dir, 'shot.png');
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(harPath, JSON.stringify(harJson));
    await writeFile(pngPath, pngBytes);
    const shot = await screenshotProvenanceArg(dir, pngBytes, {
      deviceScaleFactor: 2,
      viewport: { height: 667, width: 375 },
    });
    const provenance = await provenanceArg(dir);
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => {
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
          `--expect-route=${route}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=2',
          provenance,
          shot,
          ...extra,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
  }

  it('fails a navigation to the wrong store, arm, or redirect target', async () => {
    const har = harWithPages([{ ...DATED_PAGE }]);
    const matched = await runGate(har);
    expect(JSON.parse(matched.stdout).ok).toBe(true);
    const wrongArm = structuredClone(har);
    wrongArm.log.pages[0]._url =
      'http://localhost:3000/pilot-lab/store/ogabassey?arm=control';
    const arm = await runGate(wrongArm);
    expect(arm.error).not.toBe(null);
    expect(arm.stdout).toMatch(/HAR page navigated .* expected /);
    const wrongStore = structuredClone(har);
    wrongStore.log.pages[0]._url =
      'http://localhost:3000/pilot-lab/store/other?arm=pilot';
    const store = await runGate(wrongStore);
    expect(store.error).not.toBe(null);
    expect(store.stdout).toMatch(/HAR page navigated .* expected /);
  });

  it('fails pages with no navigation URL or an unparseable expectation', async () => {
    const har = harWithPages([{ ...DATED_PAGE }]);
    delete har.log.pages[0]._url;
    const missing = await runGate(har);
    expect(missing.error).not.toBe(null);
    expect(missing.stdout).toMatch(/not a valid URL/);
    const noUrl = harWithPages([{ ...DATED_PAGE }]);
    delete noUrl.log.pages[0]._url;
    delete noUrl.log.pages[0].title;
    const absent = await runGate(noUrl);
    expect(absent.error).not.toBe(null);
    expect(absent.stdout).toMatch(/no navigation URL/);
    const badArg = await runGate(
      harWithPages([{ ...DATED_PAGE }]),
      [],
      '::not-a-url::'
    );
    expect(badArg.error).not.toBe(null);
    expect(badArg.stdout).toMatch(/bad --expect-route/);
  });

  it('fails oversized artifacts by size instead of exhausting the reader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-bounds-'));
    const harPath = join(dir, 'huge.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(pngPath, await pngBuffer(750, 1334));
    // Sparse 257 MiB file: instant to create, over the 256 MiB HAR
    // budget, and the bounded reader stops after the ceiling.
    const { open } = await import('node:fs/promises');
    const handle = await open(harPath, 'w');
    try {
      await handle.truncate(257 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const { execFile } = await import('node:child_process');
    const gatePath = join(
      // @ts-expect-error import.meta.dirname is provided by vitest.
      import.meta.dirname,
      'merchant-image-pilot-settings.mjs'
    );
    const base = [
      `--screenshot=${pngPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      '--cache-provenance=test-fresh-profile',
    ];
    const huge = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [gatePath, `--har=${harPath}`, ...base],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(huge.error).not.toBe(null);
    expect(huge.stdout).toMatch(/exceeds the HAR byte budget/);
    // An oversized provenance record fails by the same operator-JSON
    // budget instead of buffering an unbounded file.
    const har = harWithPages([{ ...DATED_PAGE }]);
    const smallHar = join(dir, 'run.har');
    await writeFile(smallHar, JSON.stringify(har));
    const bigProvenance = join(dir, 'big-cache.json');
    await writeFile(bigProvenance, `{"pad":"${'x'.repeat(1024 * 1024)}"}`);
    const big = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          gatePath,
          `--har=${smallHar}`,
          ...base.filter((arg) => !arg.startsWith('--cache-provenance=')),
          `--cache-provenance=${bigProvenance}`,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(big.error).not.toBe(null);
    expect(big.stdout).toMatch(/exceeds the operator-JSON budget/);
  });
});

describe('merchant-image-pilot-settings lighthouse route and evidence bounds', () => {
  const LH_FLAGS = [
    '--expect-form-factor=mobile',
    '--expect-throttling-method=simulate',
    '--expect-rtt-ms=150',
    '--expect-throughput-kbps=1638.4',
    '--expect-lh-viewport=412x823',
    '--expect-lh-dpr=1.75',
    '--expect-cpu-slowdown=4',
  ];

  function lhReport(urls) {
    return {
      configSettings: {
        formFactor: 'mobile',
        screenEmulation: {
          deviceScaleFactor: 1.75,
          disabled: false,
          height: 823,
          mobile: true,
          width: 412,
        },
        throttling: {
          cpuSlowdownMultiplier: 4,
          rttMs: 150,
          throughputKbps: 1638.4,
        },
        throttlingMethod: 'simulate',
      },
      environment: {},
      ...urls,
    };
  }

  async function runWithReport({ harPages, pngBytes, report, shotBytes }) {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-lhroute-'));
    const harPath = join(dir, 'run.har');
    const pngPath = join(dir, 'shot.png');
    const lhPath = join(dir, 'report.json');
    const shot = shotBytes ?? pngBytes;
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
          pages: harPages,
        },
      })
    );
    await writeFile(pngPath, pngBytes);
    await writeFile(lhPath, JSON.stringify(report));
    const provenance = await provenanceArg(dir);
    const shotArg = await screenshotProvenanceArg(dir, shot, {
      deviceScaleFactor: 2,
      viewport: { height: 667, width: 375 },
    });
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => {
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
          `--lighthouse=${lhPath}`,
          '--expect-iterations=1',
          '--expect-connectivity=native',
          `--expect-route=${ROUTE}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=2',
          provenance,
          shotArg,
          ...LH_FLAGS,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
  }

  it('fails Lighthouse evidence for the wrong navigation or redirect', async () => {
    const pngBytes = await pngBuffer(750, 1334);
    const harPages = [{ ...DATED_PAGE }];
    const matched = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport({ finalDisplayedUrl: ROUTE, requestedUrl: ROUTE }),
    });
    expect(JSON.parse(matched.stdout).ok).toBe(true);
    const wrongArm = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport({
        finalDisplayedUrl: ROUTE,
        requestedUrl:
          'http://localhost:3000/pilot-lab/store/ogabassey?arm=control',
      }),
    });
    expect(wrongArm.error).not.toBe(null);
    expect(wrongArm.stdout).toMatch(/requestedUrl is .* expected /);
    const redirected = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport({
        finalDisplayedUrl: 'http://localhost:3000/pilot-lab/store/other',
        requestedUrl: ROUTE,
      }),
    });
    expect(redirected.error).not.toBe(null);
    expect(redirected.stdout).toMatch(/finalDisplayedUrl is .* expected /);
  });

  it('rejects a structurally valid screenshot whose pixels do not decode', async () => {
    // Valid signature, IHDR, CRCs, and IDAT presence — but garbage
    // compressed pixels: pngDimensions accepts it, the pixel decode must
    // not, or the gate greens with no reviewable visual artifact.
    const { pngCrc32 } = await import(
      './merchant-image-pilot-settings-helpers.mjs'
    );
    const tiny = await pngBuffer(48, 48);
    const ihdr = tiny.subarray(0, 33);
    const iend = tiny.subarray(tiny.length - 12);
    const garbage = Buffer.from('this-is-not-deflate-pixel-data');
    const idatLength = Buffer.alloc(4);
    idatLength.writeUInt32BE(garbage.length);
    const idatType = Buffer.from('IDAT');
    const idatCrc = Buffer.alloc(4);
    idatCrc.writeUInt32BE(
      pngCrc32(Buffer.concat([idatType, garbage]), 0, 4 + garbage.length)
    );
    const corrupt = Buffer.concat([
      ihdr,
      idatLength,
      idatType,
      garbage,
      idatCrc,
      iend,
    ]);
    const { pngDimensions } = await import(
      './merchant-image-pilot-settings-helpers.mjs'
    );
    expect(() => pngDimensions(corrupt)).not.toThrow();
    const rejected = await runWithReport({
      harPages: [{ ...DATED_PAGE }],
      pngBytes: corrupt,
      report: lhReport({ finalDisplayedUrl: ROUTE, requestedUrl: ROUTE }),
    });
    expect(rejected.error).not.toBe(null);
    expect(rejected.stdout).toMatch(/screenshot pixels do not decode/);
  });

  it('fails oversized lighthouse and screenshot artifacts by size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-lhbounds-'));
    const { open } = await import('node:fs/promises');
    const sparse = async (name, bytes) => {
      const path = join(dir, name);
      const handle = await open(path, 'w');
      try {
        await handle.truncate(bytes);
      } finally {
        await handle.close();
      }
      return path;
    };
    const pngBytes = await pngBuffer(750, 1334);
    const harPath = join(dir, 'run.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(
      harPath,
      JSON.stringify({ log: { entries: [], pages: [{ ...DATED_PAGE }] } })
    );
    await writeFile(pngPath, pngBytes);
    const provenance = await provenanceArg(dir);
    const shotArg = await screenshotProvenanceArg(dir, pngBytes, {
      deviceScaleFactor: 2,
      viewport: { height: 667, width: 375 },
    });
    const { execFile } = await import('node:child_process');
    const gatePath = join(
      // @ts-expect-error import.meta.dirname is provided by vitest.
      import.meta.dirname,
      'merchant-image-pilot-settings.mjs'
    );
    const base = [
      `--har=${harPath}`,
      `--screenshot=${pngPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      provenance,
      shotArg,
    ];
    const hugeReport = await sparse('huge-report.json', 65 * 1024 * 1024);
    const lh = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [gatePath, ...base, `--lighthouse=${hugeReport}`, ...LH_FLAGS],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(lh.error).not.toBe(null);
    expect(lh.stdout).toMatch(/exceeds the lighthouse byte budget/);
    const hugeShot = await sparse('huge-shot.png', 65 * 1024 * 1024);
    const shot = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          gatePath,
          ...base.filter((arg) => !arg.startsWith('--screenshot=')),
          `--screenshot=${hugeShot}`,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(shot.error).not.toBe(null);
    expect(shot.stdout).toMatch(/exceeds the screenshot byte budget/);
  });
});
