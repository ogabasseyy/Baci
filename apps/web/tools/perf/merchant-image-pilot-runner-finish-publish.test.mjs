import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishBoundSet } from './merchant-image-pilot-runner-finish-publish.mjs';

const HAR = { log: { pages: [], version: '1.2' } };
const LAUNCH = { event: 'browser-launch' };
const RESET = '{"event":"profile-reset"}';

async function shot(dir, bytes = Buffer.from('shot-bytes')) {
  const path = join(dir, 'shot.png');
  await writeFile(path, bytes);
  return {
    bytes,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

describe('publishBoundSet', () => {
  it('publishes the verified screenshot bytes beside the capture record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-publish-'));
    const screenshot = await shot(dir);
    const out = join(dir, 'bound');
    await publishBoundSet({
      capture: { screenshotSha256: screenshot.sha256 },
      harJson: HAR,
      launch: LAUNCH,
      out,
      resetBytes: RESET,
      screenshot: screenshot.path,
    });
    expect(await readFile(join(out, 'screenshot.png'))).toEqual(
      screenshot.bytes
    );
  });

  it('refuses a screenshot swapped after capture binding', async () => {
    // The capture record hashes bytes read at bind time; publish must
    // re-read, compare, and refuse on drift — never copy a pathname
    // whose bytes changed underneath the recorded hash.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-publish-swap-'));
    const screenshot = await shot(dir);
    await writeFile(screenshot.path, Buffer.from('swapped-bytes'));
    const out = join(dir, 'bound');
    await expect(
      publishBoundSet({
        capture: { screenshotSha256: screenshot.sha256 },
        harJson: HAR,
        launch: LAUNCH,
        out,
        resetBytes: RESET,
        screenshot: screenshot.path,
      })
    ).rejects.toThrow(/screenshot changed after capture binding/);
  });
});
