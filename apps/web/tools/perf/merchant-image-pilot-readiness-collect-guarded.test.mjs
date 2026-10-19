import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSurface } from './merchant-image-pilot-readiness-collect.mjs';
import {
  fakeImg,
  fakePage,
  stubBrowser,
} from './merchant-image-pilot-readiness-collect-harness.mjs';

// Guarded control decode, split out of the collect suite under the
// repo line ceiling: staged bytes are read no-follow and bounded,
// never decoded through the pathname.
describe('collectSurface guarded control decode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function controlImg() {
    return fakeImg({
      currentSrc: 'https://lab/__pilot/originals/x.png?w=1200',
      getAttribute: (name) =>
        name === 'srcset'
          ? 'https://lab/__pilot/originals/x.png?w=1200 1200w'
          : null,
      naturalHeight: 12,
      naturalWidth: 16,
    });
  }

  function collectControl(publicDir) {
    stubBrowser({ selectedImg: controlImg(), slotImg: null });
    return collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'control', publicDir }
    );
  }

  it('refuses dims from a symlink swapped in for the staged original', async () => {
    // A link to outside bytes must fail the surface closed, not
    // certify the target's dimensions as the staged width.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-collect-link-'));
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    const outside = await sharp({
      create: { background: '#1c1917', channels: 3, height: 72, width: 96 },
    })
      .png()
      .toBuffer();
    await writeFile(join(publicDir, 'outside.png'), outside);
    await symlink(
      join(publicDir, 'outside.png'),
      join(publicDir, '__pilot', 'originals', 'x.png')
    );
    const collected = await collectControl(publicDir);
    expect(collected.geometry.selectedImg?.resourceWidth).toBeNull();
    expect(collected.geometry.selectedImg?.controlBytesUnverified).toBe(true);
  });

  it('refuses a FIFO swapped in for the staged original without hanging', async () => {
    // O_NONBLOCK + the fstat file check refuse before the first
    // read: a pathname decode would block the gate past every
    // deadline instead. mkfifo exists only on POSIX.
    if (process.platform === 'win32') {
      return;
    }
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-collect-fifo-'));
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    execFileSync('mkfifo', [join(publicDir, '__pilot', 'originals', 'x.png')]);
    const collected = await collectControl(publicDir);
    expect(collected.geometry.selectedImg?.resourceWidth).toBeNull();
    expect(collected.geometry.selectedImg?.controlBytesUnverified).toBe(true);
  });
});
