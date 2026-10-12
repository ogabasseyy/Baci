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
  await writeFile(
    path,
    [
      '[browsertime] Launching Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `  --user-data-dir=${profileDir} --headless --no-first-run`,
      '[1702635762.891][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "154.0.0.0" } } }',
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
// version null when that session records no capabilities line. Used to
// prove version parsing binds to the prepared-profile launch segment.
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
      lines.push(
        `[1702635762.891][INFO]: RESPONSE InitSession { "value": { "capabilities": { "browserName": "chrome", "browserVersion": "${session.version}" } } }`
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
// with the standard finishRun argument object.
export async function finishBase(dir) {
  const profileDir = join(dir, 'profile');
  const prepared = await prepareRun({
    outDir: join(dir, 'run'),
    profileDir,
    tool: 'browsertime',
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
      dpr: '2',
      har: harPath,
      outDir: join(dir, 'bound'),
      runJson: join(dir, 'run', 'run.json'),
      screenshot: shotPath,
      viewport: '375x667',
    },
    prepared,
    profileDir,
  };
}
