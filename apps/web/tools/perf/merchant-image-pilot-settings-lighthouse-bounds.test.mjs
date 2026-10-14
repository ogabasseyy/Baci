import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserProvenanceArg,
  DATED_PAGE,
  pngBuffer,
  provenanceArg,
  ROUTE,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';
import {
  HOST_UA,
  LH_FLAGS,
  lhReport,
  runWithReport,
} from './merchant-image-pilot-settings-lighthouse-harness.mjs';

describe('merchant-image-pilot-settings lighthouse route and evidence bounds', () => {
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

  it('fails a Lighthouse report from a different Chrome major', async () => {
    // Matching route, viewport, and throttling does not make metrics
    // from another browser build comparable: the host UA (the real
    // executable, not emulated configuration) must show the expected
    // major.
    const pngBytes = await pngBuffer(750, 1334);
    const harPages = [{ ...DATED_PAGE }];
    const urls = { finalDisplayedUrl: ROUTE, requestedUrl: ROUTE };
    const matched = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport(urls),
    });
    expect(JSON.parse(matched.stdout).ok).toBe(true);
    const otherMajor = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport(urls, HOST_UA.replace('Chrome/154.', 'Chrome/153.')),
    });
    expect(otherMajor.error).not.toBe(null);
    expect(otherMajor.stdout).toMatch(/lighthouse\.browser/);
    const missingUa = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport(urls, null),
    });
    expect(missingUa.error).not.toBe(null);
    expect(missingUa.stdout).toMatch(/lighthouse\.browser/);
    // chrome-headless-shell nests the full-Chrome token inside its
    // own (`HeadlessChrome/154.` contains `Chrome/154.`): without an
    // explicit shell rejection, shell evidence would qualify as the
    // matched full-Chrome run the measurement contract requires.
    const shellUA = HOST_UA.replace('Chrome/154.', 'HeadlessChrome/154.');
    const shell = await runWithReport({
      harPages,
      pngBytes,
      report: lhReport(urls, shellUA),
    });
    expect(shell.error).not.toBe(null);
    expect(shell.stdout).toMatch(/lighthouse\.browser/);
    expect(shell.stdout).toMatch(/chrome-headless-shell/);
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
    const browser = await browserProvenanceArg(dir);
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
      browser,
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
