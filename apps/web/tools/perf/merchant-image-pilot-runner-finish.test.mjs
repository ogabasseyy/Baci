import {
  mkdtemp,
  readdir,
  readFile,
  rename as realRename,
  writeFile,
} from 'node:fs/promises';
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

async function prepareAndBind(dir) {
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
  const shotPath = join(dir, 'shot.png');
  // Capture AFTER the HAR it binds: finish refuses captures that
  // predate the navigation, so each (re)finish re-captures after
  // writing its HAR. Sampling startedDateTime before the capture
  // write keeps the ordering deterministic (no same-millisecond race).
  const capture = async () => writeFile(shotPath, await pngBuffer(750, 1334));
  const outDir = join(dir, 'bound');
  const base = {
    browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
    outDir,
    runJson: join(dir, 'run', 'run.json'),
    screenshot: shotPath,
  };
  return { base, capture, outDir, writeHar };
}

async function boundBytes(outDir) {
  const snap = new Map();
  for (const name of [
    'browser-launch.json',
    'profile-reset.json',
    'run.har',
    'screenshot-capture.json',
    'screenshot.png',
  ]) {
    snap.set(name, await readFile(join(outDir, name)));
  }
  return snap;
}

async function expectBoundSet(snap, outDir) {
  for (const [name, bytes] of snap) {
    expect(await readFile(join(outDir, name))).toEqual(bytes);
  }
}

async function expectNoPublishDebris(dir) {
  const siblings = await readdir(dir);
  expect(
    siblings.filter((n) => n.includes('.staging-') || n.includes('.prev-'))
  ).toEqual([]);
}

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

  it('a failed swap restores the previous bound set byte-identical', async () => {
    // ENOSPC-style mid-publish failure after the backup move: the old
    // set is restored live, the partial staging is cleaned, and no
    // debris sibling survives beside the destination.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-swap-'));
    const { base, capture, outDir, writeHar } = await prepareAndBind(dir);
    const firstHar = join(dir, 'first.har');
    await writeHar(firstHar);
    await capture();
    await finishRun({ ...base, har: firstHar });
    const before = await boundBytes(outDir);
    const secondHar = join(dir, 'second.har');
    await writeHar(secondHar);
    await capture();
    let renames = 0;
    const io = {
      rename(from, to) {
        renames += 1;
        if (renames === 2) {
          const failure = new Error('EIO: swap rename failed');
          failure.code = 'EIO';
          throw failure;
        }
        return realRename(from, to);
      },
    };
    await expect(finishRun({ ...base, har: secondHar, io })).rejects.toThrow(
      /EIO: swap rename failed/
    );
    // Backup move, failed swap, restore move.
    expect(renames).toBe(3);
    await expectBoundSet(before, outDir);
    await expectNoPublishDebris(dir);
  });

  it('a failed staged write leaves the previous bound set live', async () => {
    // Failure before the swap begins: the destination is untouched
    // (the old set never moved aside) and the staging dir is cleaned.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-stage-'));
    const { base, capture, outDir, writeHar } = await prepareAndBind(dir);
    const firstHar = join(dir, 'first.har');
    await writeHar(firstHar);
    await capture();
    await finishRun({ ...base, har: firstHar });
    const before = await boundBytes(outDir);
    const secondHar = join(dir, 'second.har');
    await writeHar(secondHar);
    await capture();
    const io = {
      copyFile() {
        throw new Error('ENOSPC: staged screenshot write failed');
      },
    };
    await expect(finishRun({ ...base, har: secondHar, io })).rejects.toThrow(
      /ENOSPC: staged screenshot write failed/
    );
    await expectBoundSet(before, outDir);
    await expectNoPublishDebris(dir);
  });

  it('refuses a destination holding files outside the bound set', async () => {
    // Foreign files refuse before anything is staged: the swap would
    // otherwise sweep them into the replaced set's backup and delete
    // operator data finish did not write.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-foreign-'));
    const { base, capture, outDir, writeHar } = await prepareAndBind(dir);
    const firstHar = join(dir, 'first.har');
    await writeHar(firstHar);
    await capture();
    await finishRun({ ...base, har: firstHar });
    const before = await boundBytes(outDir);
    await writeFile(join(outDir, 'notes.txt'), 'operator notes');
    const secondHar = join(dir, 'second.har');
    await writeHar(secondHar);
    await capture();
    await expect(finishRun({ ...base, har: secondHar })).rejects.toThrow(
      /outside the bound set \(notes\.txt\)/
    );
    expect(await readFile(join(outDir, 'notes.txt'), 'utf8')).toBe(
      'operator notes'
    );
    await expectBoundSet(before, outDir);
    await expectNoPublishDebris(dir);
  });

  it('refuses finishing over the prepare dir', async () => {
    // Same-dir-as-prepare is no longer a quiet reset skip: run.json is
    // not a bound artifact, so the swap would delete the run handle
    // the finish just read.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-samedir-'));
    const { base, capture, writeHar } = await prepareAndBind(dir);
    const harPath = join(dir, 'raw.har');
    await writeHar(harPath);
    await capture();
    await expect(
      finishRun({ ...base, har: harPath, outDir: join(dir, 'run') })
    ).rejects.toThrow(/outside the bound set \(run\.json\)/);
  });
});
