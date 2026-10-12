import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const ROUTE =
  'http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot';

// Realistic Browsertime --verbose launch line: the runner binds only
// when the recorded command line shows the prepared profile dir.
export async function browserLog(dir, name, profileDir) {
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

export function pngBuffer(width, height) {
  return sharp({
    create: { background: '#ffffff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}
