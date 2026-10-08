import { describe, expect, it } from 'vitest';
import { slotMountProblems } from './merchant-image-pilot-readiness-checks.mjs';
import {
  goodSlot,
  mount,
  pilotImg,
} from './merchant-image-pilot-readiness-checks-fixtures.mjs';

describe('merchant-image-pilot-readiness slot mounts', () => {
  it('accepts a visible decoded arm-correct mount', () => {
    expect(
      slotMountProblems(goodSlot, mount, {
        arm: 'pilot',
        dpr: 2,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([]);
    expect(
      slotMountProblems(
        {
          ...goodSlot,
          img: {
            ...pilotImg,
            currentSrc: 'https://lab/__pilot/originals/x.png',
          },
        },
        mount,
        { arm: 'control', dpr: 2, viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual([]);
  });

  it('rejects under-resolved slot images out of coverage', () => {
    // 40px box at DPR 3 needs 120px: the 80px tier decoded from the
    // approved generation but cannot cover the profile.
    expect(
      slotMountProblems(goodSlot, mount, {
        arm: 'pilot',
        dpr: 3,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([
      'slot "header-logo" image under-resolved: 80x80px serves a 40x40px box at DPR 3 (needs 120x120px for cover)',
    ]);
  });

  it('fails absent, reported, hidden, and offscreen slots', () => {
    expect(
      slotMountProblems(null, mount, {
        arm: 'pilot',
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual(['slot "header-logo" mount is absent']);
    expect(
      slotMountProblems({ ...goodSlot, status: 'not-optimized' }, mount, {
        arm: 'pilot',
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual(['slot "header-logo" renders only "not-optimized"']);
    // The motivating gap: a hidden or zero-sized header logo must fail the
    // gate even when the product card is green. Placement verdicts read
    // the mount image box, never the multi-card section.
    const withImgBox = (box) => ({
      ...goodSlot,
      img: { ...pilotImg, box },
    });
    expect(
      slotMountProblems(
        withImgBox({ height: 0, width: 0, x: 8, y: 8 }),
        mount,
        { arm: 'pilot', viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" has no visible box']);
    // Partially visible mounts are measurable (LCP-eligible): only zero
    // overlap fails.
    expect(
      slotMountProblems(
        withImgBox({ height: 40, width: 40, x: 380, y: 8 }),
        mount,
        { arm: 'pilot', dpr: 2, viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual([]);
    // Tall section below the fold with a visible mount: the mobile grid
    // wraps four cards and legitimately scrolls; the mount is measurable.
    expect(
      slotMountProblems(
        {
          ...withImgBox({ height: 40, width: 40, x: 8, y: 8 }),
          rect: { height: 1600, width: 390, x: 0, y: 0 },
        },
        mount,
        { arm: 'pilot', dpr: 2, viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual([]);
    // Fully offscreen on any edge: nonzero boxes that still decode.
    for (const box of [
      { height: 40, width: 40, x: -40, y: 8 },
      { height: 40, width: 40, x: 8, y: -40 },
      { height: 40, width: 40, x: 8, y: 844 },
      { height: 40, width: 40, x: 390, y: 8 },
    ]) {
      expect(
        slotMountProblems({ ...goodSlot, img: { ...pilotImg, box } }, mount, {
          arm: 'pilot',
          viewportHeight: 844,
          viewportWidth: 390,
        })
      ).toEqual(['slot "header-logo" is outside the viewport']);
    }
    // Missing viewport geometry fails loud instead of skipping the check.
    expect(
      slotMountProblems({ ...goodSlot }, mount, {
        arm: 'pilot',
        viewportWidth: 390,
      })
    ).toEqual([
      'slot "header-logo" viewport unverifiable (missing collection data)',
    ]);
  });

  it('requires the slot image to decode from an arm-correct staged URL', () => {
    expect(
      slotMountProblems({ ...goodSlot, img: null }, mount, {
        arm: 'pilot',
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual(['slot "header-logo" image absent']);
    expect(
      slotMountProblems(
        { ...goodSlot, img: { ...pilotImg, naturalWidth: 0 } },
        mount,
        { arm: 'pilot', viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" image did not decode']);
    expect(
      slotMountProblems(
        {
          ...goodSlot,
          img: {
            ...pilotImg,
            currentSrc: 'https://lab/__pilot/originals/x.png',
          },
        },
        mount,
        { arm: 'pilot', viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual([
      'pilot slot "header-logo" image is not from the approved generation',
    ]);
  });
});
