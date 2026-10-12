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
        environment: {
          hostUserAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
        },
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
        environment: {
          hostUserAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
        },
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
        environment: {
          hostUserAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
        },
      })
    );
    const wrongMode = await run([`--lighthouse=${lhDesktop}`, ...lhArgs]);
    expect(wrongMode.error).not.toBe(null);
    expect(wrongMode.stdout).toMatch(/lighthouse\.emulation-mode/);
  });
});
