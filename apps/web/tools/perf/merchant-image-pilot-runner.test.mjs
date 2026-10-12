import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishRun, prepareRun } from './merchant-image-pilot-runner.mjs';
import {
  browserLog,
  pngBuffer,
  ROUTE,
} from './merchant-image-pilot-runner-fixtures.mjs';

function runGate(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        join(
          // @ts-expect-error import.meta.dirname is provided by vitest.
          import.meta.dirname,
          'merchant-image-pilot-settings.mjs'
        ),
        ...args,
      ],
      (error, stdout) => resolve({ error, stdout })
    );
  });
}

describe('merchant-image-pilot-runner', () => {
  it('binds a prepare/finish round trip the settings gate accepts', async () => {
    // The money test: artifacts no operator hand-writes — the runner
    // mints the run, binds the HAR, hashes the screenshot — must pass
    // the real gate's provenance and run-binding checks.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const prepared = await prepareRun({
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
      tool: 'browsertime',
    });
    expect(prepared.runId).toMatch(/^[0-9a-f-]{36}$/);
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const harPath = join(dir, 'raw.har');
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
          pages: [
            {
              _meta: { connectivity: 'native' },
              _url: ROUTE,
              startedDateTime: new Date().toISOString(),
              title: 'u run 1',
            },
          ],
        },
      })
    );
    const finished = await finishRun({
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      browserVersion: '154.0.0.0',
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
    });
    expect(finished.runId).toBe(prepared.runId);
    // The raw export is never mutated: the stamp lands on the copy.
    expect(
      JSON.parse(await readFile(harPath, 'utf8')).log.pages[0]._meta
    ).toEqual({
      connectivity: 'native',
    });
    expect(
      JSON.parse(await readFile(finished.har, 'utf8')).log.pages[0]._meta.runId
    ).toBe(prepared.runId);
    // The launch record binds the observed executable to this run.
    expect(JSON.parse(await readFile(finished.browserLaunch, 'utf8'))).toEqual({
      event: 'browser-launch',
      executableVersion: '154.0.0.0',
      launchedAt: expect.any(String),
      runId: prepared.runId,
      tool: 'browsertime',
    });
    const gate = await runGate([
      `--har=${finished.har}`,
      `--screenshot=${join(dir, 'bound', 'screenshot.png')}`,
      `--cache-provenance=${join(dir, 'bound', 'profile-reset.json')}`,
      `--screenshot-provenance=${finished.capture}`,
      `--browser-provenance=${finished.browserLaunch}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
    ]);
    expect(gate.error).toBe(null);
    expect(JSON.parse(gate.stdout).ok).toBe(true);
  });

  it('prepare refuses a non-empty profile dir instead of blessing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    const profileDir = join(dir, 'profile');
    await prepareRun({
      outDir: join(dir, 'run'),
      profileDir,
      tool: 'browsertime',
    });
    await writeFile(join(profileDir, 'Default'), 'stale state');
    await expect(
      prepareRun({ outDir: join(dir, 'run2'), profileDir, tool: 'browsertime' })
    ).rejects.toThrow(/not empty/);
  });

  it('finish refuses a missing or malformed executable version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-'));
    await prepareRun({
      outDir: join(dir, 'run'),
      profileDir: join(dir, 'profile'),
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
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
    };
    await expect(finishRun(base)).rejects.toThrow(
      /missing required --browser-version/
    );
    await expect(
      finishRun({ ...base, browserVersion: 'debian-chromium' })
    ).rejects.toThrow(/bad --browser-version/);
  });
});
