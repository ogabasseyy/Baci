import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boxesMatch,
  pilotImageUrlsOk,
} from './merchant-image-pilot-readiness.mjs';
import {
  harUserAgent,
  pngDimensions,
} from './merchant-image-pilot-settings.mjs';

function pngBuffer(width, height) {
  const buffer = Buffer.alloc(33, 0);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('merchant-image-pilot-settings helpers', () => {
  it('reads PNG dimensions from IHDR without image deps', () => {
    expect(pngDimensions(pngBuffer(1125, 2000))).toEqual({
      height: 2000,
      width: 1125,
    });
    expect(() => pngDimensions(Buffer.alloc(33, 0))).toThrow('not a PNG');
  });

  it('extracts the browser UA from the first HAR entry', () => {
    const ua = 'Mozilla/5.0 Chrome/154.0.0.0 Mobile Safari/537.36';
    expect(
      harUserAgent({
        log: {
          entries: [
            { request: { headers: [{ name: 'User-Agent', value: ua }] } },
          ],
        },
      })
    ).toBe(ua);
    expect(harUserAgent({ log: { entries: [] } })).toBe(null);
  });

  it('fails closed on mismatched effective settings', async () => {
    // End-to-end through the CLI: a natively-shaped HAR must fail a 4G
    // expectation, and a DPR-1.75 report must fail a DPR-2 expectation.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    const lhPath = join(dir, 'report.json');
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
          pages: [{ _meta: { connectivity: 'native' }, title: 'u run 1' }],
        },
      })
    );
    await writeFile(pngPath, pngBuffer(750, 1334));
    await writeFile(
      lhPath,
      JSON.stringify({
        configSettings: {
          formFactor: 'mobile',
          screenEmulation: {
            deviceScaleFactor: 1.75,
            height: 823,
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
    const matched = await run([
      `--lighthouse=${lhPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      '--expect-form-factor=mobile',
      '--expect-throttling-method=simulate',
      '--expect-lh-viewport=412x823',
      '--expect-lh-dpr=1.75',
      '--expect-cpu-slowdown=4',
    ]);
    expect(mismatched.stdout).not.toBe(matched.stdout);
    expect(matched.error).toBe(null);
    expect(JSON.parse(matched.stdout).ok).toBe(true);
  });
});

describe('merchant-image-pilot-settings cache evidence', () => {
  async function runWithEntries(entries, extra = []) {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-cache-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: entries.map((response) => ({
            request: {
              headers: [
                {
                  name: 'User-Agent',
                  value: 'X Chrome/154.0.0.0 Y',
                },
              ],
            },
            response,
          })),
          pages: [{ _meta: { connectivity: 'native' }, title: 'u run 1' }],
        },
      })
    );
    await writeFile(pngPath, pngBuffer(750, 1334));
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
      const { error, report } = await runWithEntries([response]);
      expect(error, label).not.toBe(null);
      expect(report.failures.join('\n'), label).toMatch(/har\.cold-cache/);
    }
  });

  it('passes uncached runs without misclassifying 204s and data URLs', async () => {
    const { error, report } = await runWithEntries([
      { status: 200 },
      { status: 204 },
      { status: 200 },
    ]);
    expect(error).toBe(null);
    expect(report.ok).toBe(true);
    expect(
      report.checks.some((check) => check.name === 'har.cold-cache' && check.ok)
    ).toBe(true);
  });

  it('treats missing cache provenance as unknown, recorded provenance as gated', async () => {
    const unknown = await runWithEntries([{ status: 200 }]);
    expect(unknown.error).toBe(null);
    expect(unknown.report.ok).toBe(true);
    expect(unknown.report.warnings.join('\n')).toMatch(
      /har\.cache-provenance: unknown/
    );
    const attested = await runWithEntries(
      [{ status: 200 }],
      [
        '--cache-provenance=browsertime-fresh-profile-default',
        '--browser-version=154.0.0.0',
      ]
    );
    expect(attested.error).toBe(null);
    expect(attested.report.warnings).toEqual([]);
    expect(
      attested.report.checks.some(
        (check) => check.name === 'har.cache-provenance' && check.ok
      )
    ).toBe(true);
    expect(attested.report.recorded.cacheProvenance).toBe(
      'browsertime-fresh-profile-default'
    );
  });

  it('records the attested browser executable separately from the emulated UA', async () => {
    const unknown = await runWithEntries([{ status: 200 }]);
    expect(unknown.report.warnings.join('\n')).toMatch(
      /har\.browser-version: unknown/
    );
    const attested = await runWithEntries(
      [{ status: 200 }],
      [
        '--cache-provenance=browsertime-fresh-profile-default',
        '--browser-version=154.0.0.0',
      ]
    );
    expect(attested.error).toBe(null);
    expect(attested.report.warnings).toEqual([]);
    expect(attested.report.recorded.browserExecutable).toBe('154.0.0.0');
    const wrongMajor = await runWithEntries(
      [{ status: 200 }],
      ['--browser-version=153.0.0.0']
    );
    expect(wrongMajor.error).not.toBe(null);
    expect(wrongMajor.report.failures.join('\n')).toMatch(
      /har\.browser-version/
    );
    const malformed = await runWithEntries(
      [{ status: 200 }],
      ['--browser-version=debian-chromium']
    );
    expect(malformed.error).not.toBe(null);
  });
});

describe('merchant-image-pilot-readiness helpers', () => {
  it('matches identical rounded boxes only', () => {
    const box = { height: 400.2, width: 600.4, x: 8.1, y: 126.5 };
    expect(boxesMatch(box, { ...box })).toBe(true);
    expect(boxesMatch(box, { ...box, width: 602 })).toBe(false);
  });

  it('rejects pilot requests for staged originals', () => {
    expect(pilotImageUrlsOk(['https://lab/__pilot/abc/x.avif'])).toBe(true);
    expect(pilotImageUrlsOk(['https://lab/__pilot/originals/x.png'])).toBe(
      false
    );
  });
});
