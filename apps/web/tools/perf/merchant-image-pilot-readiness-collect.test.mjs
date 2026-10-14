import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('collectSurface', () => {
  it('collects selected w-descriptor widths and viewport geometry', async () => {
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: (name) =>
          name === 'srcset'
            ? '/__pilot/abc/x-384.avif 384w, /__pilot/abc/x-768.avif 768w'
            : null,
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    expect(collected.geometry.viewportWidth).toBe(390);
    expect(collected.geometry.viewportHeight).toBe(844);
    expect(collected.geometry.devicePixelRatio).toBe(2);
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
    // Plain-src slot images keep natural pixels (no descriptor).
    expect(collected.geometry.slots).toHaveLength(1);
    expect(collected.geometry.slots[0]?.img?.resourceWidth).toBeNull();
    expect(collected.geometry.slots[0]?.slotId).toBe('header-logo');
    expect(collected.geometry.stylesheetBytes).toBe(1200);
  });

  it('reads w-descriptors from picture source siblings', async () => {
    // Pilot mounts carry srcsets on <source> children; the fallback <img>
    // has only src. The collector must resolve the physical width from
    // the matching source, not fall back to density-corrected naturalWidth.
    const source = {
      getAttribute: (name) =>
        name === 'srcset'
          ? '/__pilot/abc/x-384.avif 384w, /__pilot/abc/x-768.avif 768w'
          : null,
    };
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: () => null,
        parentElement: {
          querySelectorAll: () => [source],
          tagName: 'PICTURE',
        },
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
  });

  it('derives control widths from decoded staged bytes, not descriptors', async () => {
    // The global loader labels the unchanged staged original with the
    // requested ?w: trusting 1200w for a 48px original would certify
    // an under-resolved control surface. The collector replaces the
    // label with the decoded oriented width.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-collect-control-'));
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    const bytes = await sharp({
      create: { background: '#1c1917', channels: 3, height: 36, width: 48 },
    })
      .png()
      .toBuffer();
    await writeFile(join(publicDir, '__pilot', 'originals', 'x.png'), bytes);
    stubBrowser({
      selectedImg: fakeImg({
        currentSrc: 'https://lab/__pilot/originals/x.png?w=1200',
        getAttribute: (name) =>
          name === 'srcset'
            ? 'https://lab/__pilot/originals/x.png?w=1200 1200w'
            : null,
        naturalHeight: 12,
        naturalWidth: 16,
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const collected = await collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'control', publicDir }
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(48);
    expect(
      collected.geometry.selectedImg?.controlBytesUnverified
    ).toBeUndefined();
    // Plain-src slot images have no descriptor lie to correct.
    expect(collected.geometry.slots[0]?.img?.resourceWidth).toBeNull();
    expect(
      collected.geometry.slots[0]?.img?.controlBytesUnverified
    ).toBeUndefined();
  });

  it('marks control images unverified when staged bytes are unreadable', async () => {
    // The descriptor label must not survive a failed decode: neither
    // it nor the density-corrected naturals can stand in, so the
    // image fails the surface closed instead of certifying 1200w.
    const publicDir = await mkdtemp(
      join(tmpdir(), 'pilot-collect-unverified-')
    );
    stubBrowser({
      selectedImg: fakeImg({
        currentSrc: 'https://lab/__pilot/originals/missing.png?w=1200',
        getAttribute: (name) =>
          name === 'srcset'
            ? 'https://lab/__pilot/originals/missing.png?w=1200 1200w'
            : null,
      }),
      slotImg: null,
    });
    const collected = await collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'control', publicDir }
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBeNull();
    expect(collected.geometry.selectedImg?.controlBytesUnverified).toBe(true);
  });

  it('recovers physical width from selected x-descriptors', async () => {
    // Next Image 1x/2x sets: the browser density-corrects naturals,
    // so a null resourceWidth would halve the pixels in resolution
    // verdicts (96px original read as 48px). The recovered value
    // also unlocks the decoded-bytes override on control.
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: (name) =>
          name === 'srcset'
            ? '/__pilot/abc/x-384.avif 1x, /__pilot/abc/x-768.avif 2x'
            : null,
        naturalHeight: 375,
        naturalWidth: 384,
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const collected = await collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'pilot' }
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
  });

  it('decodes control bytes for x-described images', async () => {
    // The finding's exact case: a control 1x/2x set must engage the
    // decoded-width override (exact bytes) instead of keeping the
    // density-corrected naturals.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-collect-x-'));
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    const bytes = await sharp({
      create: { background: '#1c1917', channels: 3, height: 72, width: 96 },
    })
      .png()
      .toBuffer();
    await writeFile(join(publicDir, '__pilot', 'originals', 'x.png'), bytes);
    stubBrowser({
      selectedImg: fakeImg({
        currentSrc: 'https://lab/__pilot/originals/x.png',
        getAttribute: (name) =>
          name === 'srcset' ? 'https://lab/__pilot/originals/x.png 2x' : null,
        naturalHeight: 36,
        naturalWidth: 48,
      }),
      slotImg: null,
    });
    const collected = await collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'control', publicDir }
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(96);
    expect(
      collected.geometry.selectedImg?.controlBytesUnverified
    ).toBeUndefined();
  });

  it('leaves pilot descriptors untouched without staged access', async () => {
    // Pilot tiers are distinct files per candidate, so the collected
    // descriptor IS the physical width — no decode, no publicDir
    // needed, and a missing publicDir must not fail the pilot arm.
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: (name) =>
          name === 'srcset'
            ? '/__pilot/abc/x-384.avif 384w, /__pilot/abc/x-768.avif 768w'
            : null,
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const collected = await collectSurface(
      fakePage(),
      'https://lab/pilot-lab/store/omnimart',
      'grid',
      { arm: 'pilot', publicDir: join(tmpdir(), 'pilot-collect-no-such-dir') }
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
    expect(
      collected.geometry.selectedImg?.controlBytesUnverified
    ).toBeUndefined();
  });
});
