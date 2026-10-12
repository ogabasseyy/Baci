import { mkdtemp, readFile } from 'node:fs/promises';
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
});
