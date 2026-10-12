import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishRun } from './merchant-image-pilot-runner-finish.mjs';
import {
  browserLogSessions,
  finishBase,
} from './merchant-image-pilot-runner-fixtures.mjs';

describe('merchant-image-pilot-runner version binding', () => {
  it('binds the version to the prepared-profile launch segment', async () => {
    // A retry (or unrelated browser) later in the same verbose log must
    // neither supply nor override the recorded executable version: the
    // HAR UA is emulatable, so the gate cannot catch a swap.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const { base, profileDir } = await finishBase(dir);
    const log = await browserLogSessions(dir, 'retry.log', [
      { profileDir, version: '154.0.0.0' },
      { profileDir: '/tmp/unrelated-profile', version: '153.0.0.0' },
    ]);
    const bound = await finishRun({ ...base, browserLog: log });
    const launch = JSON.parse(await readFile(bound.browserLaunch, 'utf8'));
    expect(launch.executableVersion).toBe('154.0.0.0');
    // launchedAt is the prepared session's own stamp — never the reset
    // time, which would make the gate's ordering check vacuous.
    expect(launch.launchedAt).toBe(
      new Date(1702635762.891 * 1000).toISOString()
    );
  });

  it('refuses when only a later session records a version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const { base, profileDir } = await finishBase(dir);
    const log = await browserLogSessions(dir, 'unbound.log', [
      { profileDir, version: null },
      { profileDir: '/tmp/unrelated-profile', version: '153.0.0.0' },
    ]);
    await expect(finishRun({ ...base, browserLog: log })).rejects.toThrow(
      /prepared-profile launch records no browserVersion/
    );
  });

  it('refuses a screenshot whose pixels disagree with the session viewport', async () => {
    // finishBase captures 750x1334: a session attesting 750x1334 at
    // dpr 2 must refuse, not mint geometry the gate would trust from
    // the record alone.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const { base, profileDir } = await finishBase(dir, {
      viewport: '750x1334',
    });
    const log = await browserLogSessions(dir, 'geo.log', [
      { profileDir, version: '154.0.0.0' },
    ]);
    await expect(finishRun({ ...base, browserLog: log })).rejects.toThrow(
      /screenshot is 750x1334 but viewport 750x1334 at dpr 2 requires 1500x2668/
    );
  });

  it('refuses a non-PNG screenshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const { base, profileDir } = await finishBase(dir);
    await writeFile(base.screenshot, 'not a png file');
    const log = await browserLogSessions(dir, 'notpng.log', [
      { profileDir, version: '154.0.0.0' },
    ]);
    await expect(finishRun({ ...base, browserLog: log })).rejects.toThrow(
      /screenshot is not a PNG file/
    );
  });

  it('refuses a HAR captured before the prepared session', async () => {
    // Foreign navigation first, prepared launch after: the HAR start
    // precedes the session stamp, so binding would certify evidence the
    // proven executable never produced.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const { base, profileDir } = await finishBase(dir);
    const future = (Date.now() + 60_000) / 1000;
    const stamp = `${Math.floor(future)}.${String(
      Math.floor((future % 1) * 1000)
    ).padStart(3, '0')}`;
    const log = await browserLogSessions(dir, 'late-launch.log', [
      { profileDir, stamp, version: '154.0.0.0' },
    ]);
    await expect(finishRun({ ...base, browserLog: log })).rejects.toThrow(
      /HAR page predates the prepared-browser session/
    );
  });
});
