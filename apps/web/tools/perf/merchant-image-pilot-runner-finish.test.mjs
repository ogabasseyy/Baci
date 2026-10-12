import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
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
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
    });
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const base = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      dpr: '2',
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
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
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
    });
    const harPath = join(dir, 'raw.har');
    await writeHar(harPath);
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const args = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
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
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
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
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const firstHar = join(dir, 'first.har');
    await writeHar(firstHar);
    const outDir = join(dir, 'bound');
    const base = {
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      dpr: '2',
      outDir,
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
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

  it('refuses a HAR whose browser never launched the prepared profile', async () => {
    // The default-profile accident: the operator captures with another
    // profile, so the recorded command line shows no launch with the
    // prepared dir — binding would stamp a warm navigation as cold.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const prepared = await prepareRun({
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
    });
    expect(
      JSON.parse(await readFile(join(dir, 'run', 'run.json'), 'utf8'))
    ).toEqual({
      profileDir: join(dir, 'profile'),
      runId: prepared.runId,
      tool: 'browsertime',
    });
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const harPath = join(dir, 'raw.har');
    await writeFile(
      harPath,
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
    const base = {
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
    };
    const defaultLog = await browserLog(
      dir,
      'default.log',
      '/tmp/accidental-default'
    );
    await expect(
      finishRun({ ...base, browserLog: defaultLog })
    ).rejects.toThrow(/no launch with the prepared profile dir/);
    // A sibling-prefix path must not satisfy the match either.
    const prefixLog = await browserLog(
      dir,
      'prefix.log',
      `${join(dir, 'profile')}-sibling`
    );
    await expect(finishRun({ ...base, browserLog: prefixLog })).rejects.toThrow(
      /no launch with the prepared profile dir/
    );
  });

  it('finish refuses a log with two launches of the prepared profile', async () => {
    // A retry with the same profile dir (warm-up run, then a second run
    // whose single-page HAR is submitted) must not stamp a warm
    // navigation with the reset's cold run id. Refused before version
    // parsing, so no version line is needed to reach it.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
    });
    const harPath = join(dir, 'raw.har');
    await writeFile(
      harPath,
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
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, await pngBuffer(750, 1334));
    const twoLaunchLog = join(dir, 'two-launch.log');
    await writeFile(
      twoLaunchLog,
      [
        '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `  --user-data-dir=${join(dir, 'profile')} --headless --no-first-run`,
        '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `  --user-data-dir=${join(dir, 'profile')} --headless --no-first-run`,
      ].join('\n')
    );
    await expect(
      finishRun({
        browserLog: twoLaunchLog,
        dpr: '2',
        har: harPath,
        outDir: join(dir, 'bound'),
        runJson: join(dir, 'run', 'run.json'),
        screenshot: shotPath,
        viewport: '375x667',
      })
    ).rejects.toThrow(/2 launches with the prepared profile dir/);
  });

  it('binds the screenshot mtime and refuses out-of-window captures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const prepared = await prepareRun({
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
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
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      viewport: '375x667',
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
