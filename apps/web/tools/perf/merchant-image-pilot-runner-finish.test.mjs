import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

describe('merchant-image-pilot-runner finish binding', () => {
  it('finish refuses multi-page, rebound, stale, and future HARs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const base = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
    };
    const writeHar = (name, pages) =>
      writeFile(name, JSON.stringify({ log: { entries: [], pages } }));
    const page = (overrides = {}) => ({
      _url: ROUTE,
      startedDateTime: new Date().toISOString(),
      title: 'u run 1',
      ...overrides,
    });
    const multi = join(dir, 'multi.har');
    await writeHar(multi, [page(), page()]);
    await expect(finishRun({ ...base, har: multi })).rejects.toThrow(
      /exactly one page/
    );
    const rebound = join(dir, 'rebound.har');
    await writeHar(rebound, [page({ _meta: { runId: 'another-run' } })]);
    await expect(finishRun({ ...base, har: rebound })).rejects.toThrow(
      /already bound/
    );
    const stale = join(dir, 'stale.har');
    await writeHar(stale, [
      page({ startedDateTime: new Date(Date.now() - 3_700_000).toISOString() }),
    ]);
    await expect(finishRun({ ...base, har: stale })).rejects.toThrow(
      /older than one hour/
    );
    const future = join(dir, 'future.har');
    await writeHar(future, [
      page({ startedDateTime: new Date(Date.now() + 60_000).toISOString() }),
    ]);
    await expect(finishRun({ ...base, har: future })).rejects.toThrow(/future/);
  });

  it('re-finishing the same run is idempotent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    const harPath = join(dir, 'raw.har');
    await writeHar(harPath);
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const args = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
    };
    const first = await finishRun(args);
    // Second finish binds the already-stamped copy: same run, no conflict.
    const second = await finishRun({ ...args, har: first.har });
    expect(second.runId).toBe(first.runId);

    async function writeHar(name) {
      await writeFile(
        name,
        JSON.stringify({
          log: {
            entries: [],
            pages: [
              {
                _url: ROUTE,
                startedDateTime: new Date().toISOString(),
                title: 'u run 1',
              },
            ],
          },
        })
      );
    }
  });

  it('leaves the earlier bound set untouched when a retry fails validation', async () => {
    // A retry carries a new HAR for a new navigation: when its
    // screenshot then fails validation, the earlier finish's HAR and
    // screenshot must both survive byte-identical — never a new HAR
    // stranded beside an old screenshot under one run id.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-atomic-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    const writeHar = (name) =>
      writeFile(
        name,
        JSON.stringify({
          log: {
            entries: [],
            pages: [
              {
                _url: ROUTE,
                startedDateTime: new Date().toISOString(),
                title: 'u run 1',
              },
            ],
          },
        })
      );
    // HAR first, screenshot second: the capture must not predate the
    // navigation it binds.
    const firstHar = join(dir, 'first.har');
    await writeHar(firstHar);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, await pngBuffer(750, 1334));
    const outDir = join(dir, 'bound');
    const base = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      outDir,
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
    };
    await finishRun({ ...base, har: firstHar });
    const harBefore = await readFile(join(outDir, 'run.har'));
    const shotBefore = await readFile(join(outDir, 'screenshot.png'));
    // New navigation, valid HAR — but a wrong-geometry screenshot.
    const secondHar = join(dir, 'second.har');
    await writeHar(secondHar);
    const badShot = join(dir, 'bad.png');
    await writeFile(badShot, await pngBuffer(100, 100));
    await expect(
      finishRun({ ...base, har: secondHar, screenshot: badShot })
    ).rejects.toThrow(/requires 750x1334/);
    expect(await readFile(join(outDir, 'run.har'))).toEqual(harBefore);
    expect(await readFile(join(outDir, 'screenshot.png'))).toEqual(shotBefore);
  });
});
