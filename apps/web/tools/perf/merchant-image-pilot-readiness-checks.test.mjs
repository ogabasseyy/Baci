import { describe, expect, it } from 'vitest';
import {
  boxesMatch,
  crossArmProblems,
  pilotImageUrlsOk,
  selectedImageProblems,
  slotMountProblems,
  surfaceProblems,
} from './merchant-image-pilot-readiness-checks.mjs';

describe('merchant-image-pilot-readiness helpers', () => {
  it('matches identical rounded boxes only', () => {
    const box = { height: 400.2, width: 600.4, x: 8.1, y: 126.5 };
    expect(boxesMatch(box, { ...box })).toBe(true);
    expect(boxesMatch(box, { ...box, width: 602 })).toBe(false);
  });

  it('rejects pilot requests for staged originals', () => {
    expect(pilotImageUrlsOk(['https://lab/__pilot/abc/x.avif'])).toBe(true);
    expect(pilotImageUrlsOk(['https://lab/__pilot/originals/x.png'])).toBe(
      false
    );
  });

  it('requires the selected image to decode from a staged URL', () => {
    const pilot = {
      complete: true,
      currentSrc: 'https://lab/__pilot/abc/x.avif',
      naturalWidth: 384,
    };
    const control = {
      complete: true,
      currentSrc: 'https://lab/__pilot/originals/x.png',
      naturalWidth: 1254,
    };
    expect(selectedImageProblems(pilot, 'pilot')).toEqual([]);
    expect(selectedImageProblems(control, 'control')).toEqual([]);
    // Absent, undecoded, or sourceless elements fail in both arms.
    for (const arm of ['pilot', 'control']) {
      expect(selectedImageProblems(null, arm)).toEqual([
        'selected image absent',
      ]);
      expect(selectedImageProblems({ ...pilot, complete: false }, arm)).toEqual(
        ['selected image did not decode']
      );
      expect(selectedImageProblems({ ...pilot, naturalWidth: 0 }, arm)).toEqual(
        ['selected image did not decode']
      );
      expect(selectedImageProblems({ ...pilot, currentSrc: '' }, arm)).toEqual([
        'selected image has no source',
      ]);
    }
    // Wrong-arm staged URLs fail: pilot on an original, control off one.
    expect(
      selectedImageProblems(
        { ...pilot, currentSrc: control.currentSrc },
        'pilot'
      )
    ).toEqual(['pilot selected a non-staged image URL']);
    expect(
      selectedImageProblems(
        { ...control, currentSrc: 'https://lab/other/x.png' },
        'pilot'
      )
    ).toEqual(['pilot selected a non-staged image URL']);
    expect(
      selectedImageProblems(
        { ...control, currentSrc: pilot.currentSrc },
        'control'
      )
    ).toEqual(['control selected no staged original']);
  });
});

describe('merchant-image-pilot-readiness slot mounts', () => {
  const mount = {
    binding: 'merchant/logo-a',
    merchantId: 'merchant',
    slotId: 'header-logo',
  };
  const pilotImg = {
    complete: true,
    currentSrc: 'https://lab/__pilot/abc/x.avif',
    naturalWidth: 80,
  };
  const goodSlot = {
    binding: 'merchant/logo-a',
    img: pilotImg,
    rect: { height: 40, width: 40, x: 8, y: 8 },
    slotId: 'header-logo',
    status: null,
  };

  it('accepts a visible decoded arm-correct mount', () => {
    expect(
      slotMountProblems(goodSlot, mount, { arm: 'pilot', viewportWidth: 390 })
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
        { arm: 'control', viewportWidth: 390 }
      )
    ).toEqual([]);
  });

  it('fails absent, reported, hidden, and overflowing slots', () => {
    expect(
      slotMountProblems(null, mount, { arm: 'pilot', viewportWidth: 390 })
    ).toEqual(['slot "header-logo" mount is absent']);
    expect(
      slotMountProblems({ ...goodSlot, status: 'not-optimized' }, mount, {
        arm: 'pilot',
        viewportWidth: 390,
      })
    ).toEqual(['slot "header-logo" renders only "not-optimized"']);
    // The motivating gap: a hidden or zero-sized header logo must fail the
    // gate even when the product card is green.
    expect(
      slotMountProblems(
        { ...goodSlot, rect: { height: 0, width: 0, x: 8, y: 8 } },
        mount,
        { arm: 'pilot', viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" has no visible box']);
    expect(
      slotMountProblems(
        { ...goodSlot, rect: { height: 40, width: 40, x: 380, y: 8 } },
        mount,
        { arm: 'pilot', viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" overflows the viewport']);
  });

  it('requires the slot image to decode from an arm-correct staged URL', () => {
    expect(
      slotMountProblems({ ...goodSlot, img: null }, mount, {
        arm: 'pilot',
        viewportWidth: 390,
      })
    ).toEqual(['slot "header-logo" image absent']);
    expect(
      slotMountProblems(
        { ...goodSlot, img: { ...pilotImg, naturalWidth: 0 } },
        mount,
        { arm: 'pilot', viewportWidth: 390 }
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
        { arm: 'pilot', viewportWidth: 390 }
      )
    ).toEqual(['pilot slot "header-logo" image is a non-staged image URL']);
  });

  it('validates every expected mount on the surface', () => {
    const card = {
      binding: 'merchant/card-a',
      merchantId: 'merchant',
      slotId: 'product-card',
    };
    const cardSlot = {
      binding: 'merchant/card-a',
      img: pilotImg,
      rect: { height: 300, width: 180, x: 8, y: 120 },
      slotId: 'product-card',
      status: null,
    };
    const collected = {
      consoleErrors: [],
      failedRequests: [],
      geometry: {
        gridDisplay: 'grid',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'cover',
        selected: { height: 300, width: 180, x: 8, y: 120 },
        selectedImg: pilotImg,
        slots: [goodSlot, cardSlot],
        stylesheetBytes: 1200,
        stylesheetCount: 1,
        viewportWidth: 390,
      },
      imageUrls: ['https://lab/__pilot/abc/x.avif'],
    };
    expect(
      surfaceProblems(collected, {
        arm: 'pilot',
        expectedFit: 'cover',
        expectedMounts: [mount, card],
        surface: 'grid',
      })
    ).toEqual([]);
    // A broken logo fails the surface even though the card is perfect.
    const broken = {
      ...collected,
      geometry: {
        ...collected.geometry,
        slots: [
          { ...goodSlot, rect: { height: 0, width: 0, x: 0, y: 0 } },
          cardSlot,
        ],
      },
    };
    expect(
      surfaceProblems(broken, {
        arm: 'pilot',
        expectedFit: 'cover',
        expectedMounts: [mount, card],
        surface: 'grid',
      })
    ).toEqual(['slot "header-logo" has no visible box']);
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
