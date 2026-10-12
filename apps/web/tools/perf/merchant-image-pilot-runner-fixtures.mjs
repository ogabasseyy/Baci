import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { prepareRun } from './merchant-image-pilot-runner.mjs';

export const ROUTE =
  'http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot';

// Realistic Browsertime --verbose launch lines: the runner binds only
// when the recorded command line shows the prepared profile dir, and
// reads the executable version from the recorded chromedriver
// InitSession RESPONSE capabilities (never caller text).
export async function browserLog(dir, name, profileDir) {
  const path = join(dir, name);
  // Session 60s before the call: inside the gate's freshness window,
  // safely preceding any HAR the caller writes around this fixture.
  const sessionMs = Date.now() - 60_000;
  const stamp = `${Math.floor(sessionMs / 1000)}.${String(
    sessionMs % 1000
  ).padStart(3, '0')}`;
  await writeFile(
    path,
    [
      '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `  --user-data-dir=${profileDir} --headless --no-first-run`,
      `[${stamp}][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "154.0.0.0" } } }`,
      '[browsertime] Navigating to http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot',
    ].join('\n')
  );
  return path;
}

export function pngBuffer(width, height) {
  return sharp({
    create: { background: '#ffffff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}

// Multi-session verbose log: each session is { profileDir, version },
// version null when that session records no capabilities line, stamp
// overriding the chromedriver epoch stamp when supplied. Used to prove
// version and session-time parsing bind to the prepared-profile
// launch segment.
export async function browserLogSessions(dir, name, sessions) {
  const path = join(dir, name);
  const lines = [];
  for (const session of sessions) {
    lines.push(
      '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    );
    lines.push(
      `  --user-data-dir=${session.profileDir} --headless --no-first-run`
    );
    if (session.version) {
      const stamp = session.stamp ?? '1702635762.891';
      lines.push(
        `[${stamp}][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "${session.version}" } } }`
      );
    }
    lines.push(
      '[browsertime] Navigating to http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot'
    );
  }
  await writeFile(path, lines.join('\n'));
  return path;
}

// Ready-to-finish run: prepared handle, screenshot, and single-page HAR
// with the standard finishRun argument object. The session geometry
// defaults to the standard mobile pair; tests for mismatched captures
// attest a different pair at prepare time.
export async function finishBase(
  dir,
  { dpr = '2', viewport = '375x667' } = {}
) {
  const profileDir = join(dir, 'profile');
  const prepared = await prepareRun({
    dpr,
    outDir: join(dir, 'run'),
    profileDir,
    tool: 'browsertime',
    viewport,
  });
  // HAR first, screenshot second: finish refuses captures that predate
  // the navigation, so the shot mtime must not precede startedDateTime.
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
  return {
    base: {
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
    },
    prepared,
    profileDir,
  };
}
