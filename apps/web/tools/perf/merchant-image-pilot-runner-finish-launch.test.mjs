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

describe('merchant-image-pilot-runner finish launch binding', () => {
  it('refuses a HAR whose browser never launched the prepared profile', async () => {
    // The default-profile accident: the operator captures with another
    // profile, so the recorded command line shows no launch with the
    // prepared dir — binding would stamp a warm navigation as cold.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const prepared = await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    expect(
      JSON.parse(await readFile(join(dir, 'run', 'run.json'), 'utf8'))
    ).toEqual({
      deviceScaleFactor: 2,
      profileDir: join(dir, 'profile'),
      runId: prepared.runId,
      tool: 'browsertime',
      viewport: { height: 667, width: 375 },
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
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
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
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
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
        har: harPath,
        outDir: join(dir, 'bound'),
        runJson: join(dir, 'run', 'run.json'),
        screenshot: shotPath,
      })
    ).rejects.toThrow(/2 launches with the prepared profile dir/);
  });

  it('finish refuses one launch holding two navigations', async () => {
    // Same-session warming: one launch, navigate to warm the cache,
    // restart HAR recording, navigate again. The submitted HAR holds
    // one page and the log holds one launch, so only the launch
    // segment's navigation count exposes the warm retry.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
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
    const twoNavLog = join(dir, 'two-nav.log');
    await writeFile(
      twoNavLog,
      [
        '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `  --user-data-dir=${join(dir, 'profile')} --headless --no-first-run`,
        `[${Math.floor(Date.now() / 1000)}.000][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "154.0.0.0" } } }`,
        `[browsertime] Navigating to ${ROUTE}`,
        `[browsertime] Navigating to ${ROUTE}`,
      ].join('\n')
    );
    await expect(
      finishRun({
        browserLog: twoNavLog,
        har: harPath,
        outDir: join(dir, 'bound'),
        runJson: join(dir, 'run', 'run.json'),
        screenshot: shotPath,
      })
    ).rejects.toThrow(/2 navigations in the prepared-profile launch segment/);
  });

  it('finish refuses a Browsertime HAR with a markerless log', async () => {
    // That driver always logs its navigations: a markerless log for
    // its HAR cannot rule out a warmed retry submitted as cold (e.g. a
    // chromedriver log swapped in for the verbose one).
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
    });
    const harPath = join(dir, 'raw.har');
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          creator: { name: 'Browsertime', version: '19.0.0' },
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
    const markerlessLog = join(dir, 'markerless.log');
    await writeFile(
      markerlessLog,
      [
        '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        `  --user-data-dir=${join(dir, 'profile')} --headless --no-first-run`,
        `[${Math.floor(Date.now() / 1000)}.000][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "154.0.0.0" } } }`,
      ].join('\n')
    );
    await expect(
      finishRun({
        browserLog: markerlessLog,
        har: harPath,
        outDir: join(dir, 'bound'),
        runJson: join(dir, 'run', 'run.json'),
        screenshot: shotPath,
      })
    ).rejects.toThrow(/binds only with its verbose navigation record/);
  });

  it('finish binds a logged navigation without the unverified flag', async () => {
    // The proven path stays quiet: only markerless non-Browsertime
    // segments (Caps-style drivers) carry firstNavigationUnverified.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      dpr: '2',
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
      viewport: '375x667',
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
    const bound = await finishRun({
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
    });
    const launch = JSON.parse(await readFile(bound.browserLaunch, 'utf8'));
    expect(launch.firstNavigationUnverified).toBe(undefined);
  });
});
