import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareRun } from './merchant-image-pilot-runner.mjs';
import { finishRun } from './merchant-image-pilot-runner-finish.mjs';
import {
  browserLog,
  pngBuffer,
  ROUTE,
} from './merchant-image-pilot-runner-fixtures.mjs';

describe('merchant-image-pilot-runner finish screenshot timing', () => {
  it('binds the screenshot mtime and refuses out-of-window captures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const prepared = await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    const writeHar = (name, startedDateTime) =>
      writeFile(
        name,
        JSON.stringify({
          log: {
            entries: [],
            pages: [{ _url: ROUTE, startedDateTime, title: 'u run 1' }],
          },
        })
      );
    const harPath = join(dir, 'raw.har');
    await writeHar(harPath, new Date().toISOString());
    const pngBytes = await pngBuffer(750, 1334);
    const base = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
    };
    // A stale file from another run gains no fresh capturedAt.
    const staleShot = join(dir, 'stale.png');
    await writeFile(staleShot, pngBytes);
    await utimes(staleShot, new Date(), new Date(Date.now() - 7_200_000));
    await expect(finishRun({ ...base, screenshot: staleShot })).rejects.toThrow(
      /predates the measured navigation/
    );
    // A future-dated file is clock skew, not a capture.
    const futureShot = join(dir, 'future.png');
    await writeFile(futureShot, pngBytes);
    await utimes(futureShot, new Date(), new Date(Date.now() + 60_000));
    await expect(
      finishRun({ ...base, screenshot: futureShot })
    ).rejects.toThrow(/newer than the finish clock/);
    // A HAR older than the profile reset is another run's navigation,
    // even inside the one-hour window.
    const oldHar = join(dir, 'old.har');
    await writeHar(
      oldHar,
      new Date(Date.parse(prepared.resetAt) - 60_000).toISOString()
    );
    const freshShot = join(dir, 'fresh.png');
    await writeFile(freshShot, pngBytes);
    await expect(
      finishRun({ ...base, har: oldHar, screenshot: freshShot })
    ).rejects.toThrow(/predates the profile reset/);
  });
});
