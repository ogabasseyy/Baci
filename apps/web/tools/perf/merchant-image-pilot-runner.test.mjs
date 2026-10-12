import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { finishRun, prepareRun } from './merchant-image-pilot-runner.mjs';

const ROUTE = 'http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot';

// Realistic Browsertime --verbose launch line: the runner binds only
// when the recorded command line shows the prepared profile dir.
async function browserLog(dir, name, profileDir) {
  const path = join(dir, name);
  await writeFile(
    path,
    [
      '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `  --user-data-dir=${profileDir} --headless --no-first-run`,
      '[browsertime] Navigating to http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot',
    ].join('\n')
  );
  return path;
}

function pngBuffer(width, height) {
  return sharp({
    create: { background: '#ffffff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}

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
    const gate = await runGate([
      `--har=${finished.har}`,
      `--screenshot=${join(dir, 'bound', 'screenshot.png')}`,
      `--cache-provenance=${join(dir, 'bound', 'profile-reset.json')}`,
      `--screenshot-provenance=${finished.capture}`,
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
    const pngBytes = await pngBuffer(750, 1334);
    const shotPath = join(dir, 'shot.png');
    await writeFile(shotPath, pngBytes);
    const harPath = join(dir, 'raw.har');
    await writeHar(harPath);
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
});
