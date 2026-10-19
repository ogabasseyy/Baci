import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindScreenshotCapture } from './merchant-image-pilot-runner-finish-capture.mjs';
import { pngBuffer } from './merchant-image-pilot-runner-fixtures.mjs';

describe('merchant-image-pilot-runner-finish-capture', () => {
  it('binds a valid PNG capture inside the provenance window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-finish-capture-'));
    const screenshot = join(dir, 'shot.png');
    await writeFile(screenshot, await pngBuffer(750, 1334));
    const shotStat = await stat(screenshot);

    const record = await bindScreenshotCapture({
      clockSkewMs: 5_000,
      deviceScaleFactor: 2,
      height: 667,
      nowMs: shotStat.mtimeMs + 100,
      provenanceWindowMs: 3_600_000,
      runId: 'run-1',
      screenshot,
      startedMs: shotStat.mtimeMs - 500,
      tool: 'browsertime',
      width: 375,
    });
    expect(record.event).toBe('screenshot-capture');
    expect(record.runId).toBe('run-1');
    expect(record.screenshotSha256).toHaveLength(64);
    expect(record.viewport).toEqual({ height: 667, width: 375 });
  });

  it('rejects non-PNG files, wrong dimensions, and out-of-window timestamps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-finish-capture-bad-'));
    const badFile = join(dir, 'bad.png');
    await writeFile(badFile, 'not a png');
    const badStat = await stat(badFile);
    const baseArgs = {
      clockSkewMs: 5_000,
      deviceScaleFactor: 2,
      height: 667,
      nowMs: badStat.mtimeMs + 100,
      provenanceWindowMs: 3_600_000,
      runId: 'run-1',
      screenshot: badFile,
      startedMs: badStat.mtimeMs - 100,
      tool: 'browsertime',
      width: 375,
    };
    await expect(bindScreenshotCapture(baseArgs)).rejects.toThrow(
      /not a PNG file/
    );
    await expect(
      bindScreenshotCapture({ ...baseArgs, startedMs: badStat.mtimeMs + 1000 })
    ).rejects.toThrow(/predates the measured navigation/);
  });
});
