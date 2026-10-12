import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSurface } from './merchant-image-pilot-readiness-collect.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

function rect(x = 8, y = 8, width = 40, height = 40) {
  return { height, width, x, y };
}

function fakeImg(overrides = {}) {
  return {
    complete: true,
    currentSrc: 'https://lab/__pilot/abc/x-768.avif',
    getAttribute: (name) =>
      name === 'srcset' ? (overrides.srcset ?? null) : null,
    getBoundingClientRect: () => rect(),
    naturalHeight: 375,
    naturalWidth: 384,
    ...overrides,
  };
}

function fakePage() {
  const listeners = {};
  return {
    evaluate: async (fn, surface) => fn(surface),
    goto: async () => undefined,
    listeners,
    on: (event, handler) => {
      listeners[event] = handler;
    },
  };
}

function stubBrowser({ selectedImg, slotImg }) {
  const selected = {
    getBoundingClientRect: () => rect(),
    parentElement: {
      getBoundingClientRect: () => rect(0, 0, 390, 844),
    },
    querySelector: () => selectedImg,
  };
  const section = {
    getAttribute: (name) =>
      name === 'data-pilot-lab-slot'
        ? 'header-logo'
        : name === 'data-pilot-lab-binding'
          ? 'merchant/logo-1'
          : name === 'data-pilot-lab-status'
            ? null
            : null,
    getBoundingClientRect: () => rect(),
    querySelector: () => slotImg,
  };
  vi.stubGlobal('document', {
    baseURI: 'https://lab/pilot-lab/store/omnimart',
    querySelector: (selector) =>
      selector === '[data-pilot-lab-selected-card]' ? selected : null,
    querySelectorAll: () => [section],
  });
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    innerHeight: 844,
    innerWidth: 390,
  });
  vi.stubGlobal('getComputedStyle', () => ({
    display: 'grid',
    objectFit: 'cover',
  }));
  vi.stubGlobal('performance', {
    getEntriesByType: () => [
      {
        encodedBodySize: 1200,
        initiatorType: 'link',
        name: 'https://lab/app.css',
      },
    ],
  });
}

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
