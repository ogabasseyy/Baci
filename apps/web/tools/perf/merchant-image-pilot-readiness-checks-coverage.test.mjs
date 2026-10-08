import { describe, expect, it } from 'vitest';
import {
  crossArmProblems,
  slotMountProblems,
  surfaceProblems,
} from './merchant-image-pilot-readiness-checks.mjs';
import {
  goodSlot,
  mount,
} from './merchant-image-pilot-readiness-checks-fixtures.mjs';

describe('merchant-image-pilot-readiness coverage and cross-arm', () => {
  it('keeps route coverage but skips decode when mounts hide', () => {
    const hero = {
      binding: 'merchant/hero-s0',
      merchantId: 'merchant',
      slotId: 'mobile-hero-slide-0',
    };
    const hidden = {
      binding: 'merchant/hero-s0',
      img: { complete: false, currentSrc: '', naturalWidth: 0 },
      rect: { height: 0, width: 0, x: 0, y: 0 },
      slotId: 'mobile-hero-slide-0',
      status: null,
    };
    const collected = {
      consoleErrors: [],
      failedRequests: [],
      geometry: {
        gridDisplay: 'n/a-hero',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'contain',
        selected: { height: 0, width: 0, x: 0, y: 0 },
        selectedImg: { complete: false, currentSrc: '', naturalWidth: 0 },
        slots: [hidden],
        stylesheetBytes: 1200,
        stylesheetCount: 1,
        viewportHeight: 800,
        viewportWidth: 1280,
      },
      imageUrls: ['https://lab/__pilot/abc/x.avif'],
    };
    expect(
      surfaceProblems(collected, {
        arm: 'pilot',
        expectHiddenMounts: true,
        expectedFit: 'contain',
        expectedMounts: [hero],
        surface: 'hero',
      })
    ).toEqual([]);
    // Network-level purity still applies to hidden surfaces: a pilot
    // original fetch fails on desktop too.
    const leaked = {
      ...collected,
      imageUrls: ['https://lab/__pilot/originals/x.png'],
    };
    expect(
      surfaceProblems(leaked, {
        arm: 'pilot',
        expectHiddenMounts: true,
        expectedFit: 'contain',
        expectedMounts: [hero],
        surface: 'hero',
      })
    ).toEqual(['pilot requested a selected original']);
    // The control arm needs no original fetch when the primary is hidden:
    // a display:none hero correctly requests nothing.
    expect(
      surfaceProblems(
        { ...collected, imageUrls: [] },
        {
          arm: 'control',
          expectHiddenMounts: true,
          expectedFit: 'contain',
          expectedMounts: [hero],
          surface: 'hero',
        }
      )
    ).toEqual([]);
  });

  it('rejects stale generations and foreign originals per slot', () => {
    const slot = {
      binding: 'merchant/logo-a',
      img: {
        box: { height: 40, width: 40, x: 8, y: 8 },
        complete: true,
        currentSrc: 'https://lab/__pilot/stale/x.avif',
        naturalWidth: 80,
      },
      rect: { height: 40, width: 40, x: 8, y: 8 },
      slotId: 'header-logo',
      status: null,
    };
    expect(
      slotMountProblems(slot, mount, {
        arm: 'pilot',
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([
      'pilot slot "header-logo" image is not from the approved generation',
    ]);
    const foreign = {
      ...slot,
      img: {
        box: { height: 40, width: 40, x: 8, y: 8 },
        complete: true,
        currentSrc: 'https://lab/__pilot/originals/other.png',
        naturalWidth: 80,
      },
    };
    expect(
      slotMountProblems(foreign, mount, {
        arm: 'control',
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([
      'control slot "header-logo" image is not the approved staged original',
    ]);
  });

  it('fails closed when the primary slot has no expected mount', () => {
    const collected = {
      consoleErrors: [],
      failedRequests: [],
      geometry: {
        gridDisplay: 'grid',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'cover',
        selected: { height: 300, width: 180, x: 8, y: 120 },
        selectedImg: {
          complete: true,
          currentSrc: 'https://lab/__pilot/abc/x.avif',
          naturalWidth: 384,
        },
        slots: [],
        stylesheetBytes: 1200,
        stylesheetCount: 1,
        viewportHeight: 844,
        viewportWidth: 390,
      },
      imageUrls: ['https://lab/__pilot/abc/x.avif'],
    };
    expect(
      surfaceProblems(collected, {
        arm: 'pilot',
        expectedFit: 'cover',
        expectedMounts: [mount],
        surface: 'grid',
      })
    ).toContain('selected slot "product-card" has no expected mount');
  });

  it('compares every expected slot across arms', () => {
    const left = {
      heading: { height: 1, width: 1, x: 0, y: 0 },
      selected: { height: 300, width: 180, x: 8, y: 120 },
      slots: [goodSlot],
    };
    const right = {
      heading: { height: 1, width: 1, x: 0, y: 0 },
      selected: { height: 300, width: 180, x: 8, y: 120 },
      slots: [{ ...goodSlot }],
    };
    expect(crossArmProblems(left, right, [mount])).toEqual([]);
    const shifted = {
      ...right,
      slots: [{ ...goodSlot, rect: { height: 40, width: 40, x: 60, y: 8 } }],
    };
    expect(crossArmProblems(left, shifted, [mount])).toEqual([
      'slot "header-logo" boxes differ between arms',
    ]);
    expect(crossArmProblems(left, { ...right, slots: [] }, [mount])).toEqual([
      'slot "header-logo" missing geometry for cross-arm comparison',
    ]);
    expect(crossArmProblems(null, right, [mount])).toEqual([
      'missing geometry for cross-arm comparison',
    ]);
  });
});
