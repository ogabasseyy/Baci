import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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
    // Real capture order: navigate first, screenshot after — the runner
    // binds the screenshot's mtime to the navigation window.
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
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const finished = await finishRun({
      browserLog: await browserLog(dir, 'browser.log', join(dir, 'profile')),
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
    // The launch record binds the log-recorded executable to this run.
    expect(JSON.parse(await readFile(finished.browserLaunch, 'utf8'))).toEqual({
      event: 'browser-launch',
      executableVersion: '154.0.0.0',
      launchedAt: expect.any(String),
      runId: prepared.runId,
      tool: 'browsertime',
    });
    // capturedAt is the screenshot's OS-recorded mtime, not finish time.
    const capture = JSON.parse(await readFile(finished.capture, 'utf8'));
    expect(capture.capturedAt).toBe(
      new Date((await stat(shotPath)).mtimeMs).toISOString()
    );
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

  it('finish reads the executable version from the recorded log', async () => {
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
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const base = {
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
    };
    const launchLines = [
      '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `  --user-data-dir=${join(dir, 'profile')} --headless --no-first-run`,
    ];
    const writeLog = (name, lines) =>
      writeFile(join(dir, name), [...launchLines, ...lines].join('\n'));
    // No version line, or a non-quad one, refuses: the launch record
    // must never carry caller text the gate cannot trust.
    await writeLog('no-version.log', ['[browsertime] Navigating to u']);
    await expect(
      finishRun({ ...base, browserLog: join(dir, 'no-version.log') })
    ).rejects.toThrow(/no browserVersion/);
    await writeLog('bad-version.log', [
      'Caps: Capabilities {browserName: chrome, browserVersion: debian-chromium}',
    ]);
    await expect(
      finishRun({ ...base, browserLog: join(dir, 'bad-version.log') })
    ).rejects.toThrow(/no browserVersion/);
    // The selenium Caps rendering binds like the chromedriver JSON.
    await writeLog('caps.log', [
      'Caps: Capabilities {browserName: chrome, browserVersion: 154.0.0.0}',
    ]);
    const caps = await finishRun({
      ...base,
      browserLog: join(dir, 'caps.log'),
      outDir: join(dir, 'bound-caps'),
    });
    const capsLaunch = JSON.parse(await readFile(caps.browserLaunch, 'utf8'));
    expect(capsLaunch.executableVersion).toBe('154.0.0.0');
    // Markerless Caps segments bind (the documented fallback) with
    // first navigation explicitly unverified — never silently cold.
    expect(capsLaunch.firstNavigationUnverified).toBe(true);
    // No epoch stamp in the segment: launchedAt falls back to the reset
    // time instead of refusing the unstamped log.
    const resetAt = JSON.parse(
      await readFile(join(dir, 'run', 'profile-reset.json'), 'utf8')
    ).resetAt;
    expect(capsLaunch.launchedAt).toBe(resetAt);
    // A restarted browser logs two sessions: the later (navigating)
    // session's version wins.
    await writeLog('restart.log', [
      '[1][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserVersion": "153.0.0.0" } } }',
      '[2][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserVersion": "154.0.0.0" } } }',
    ]);
    const restart = await finishRun({
      ...base,
      browserLog: join(dir, 'restart.log'),
      outDir: join(dir, 'bound-restart'),
    });
    expect(
      JSON.parse(await readFile(restart.browserLaunch, 'utf8'))
        .executableVersion
    ).toBe('154.0.0.0');
  });
});
