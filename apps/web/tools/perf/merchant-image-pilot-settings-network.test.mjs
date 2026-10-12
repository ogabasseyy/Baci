import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DATED_PAGE,
  pngBuffer,
  provenanceArg,
  ROUTE,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';

describe('merchant-image-pilot-settings network profile evidence', () => {
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
        environment: {
          hostUserAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
        },
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
});
