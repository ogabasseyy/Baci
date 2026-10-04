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

  it('requires the selected image to decode from its approved identity', () => {
    const mount = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/x.png',
    };
    const pilot = {
      box: { height: 300, width: 180 },
      complete: true,
      currentSrc: 'https://lab/__pilot/abc/x.avif',
      naturalHeight: 384,
      naturalWidth: 384,
      objectFit: 'cover',
    };
    const control = {
      box: { height: 300, width: 180 },
      complete: true,
      currentSrc: 'https://lab/__pilot/originals/x.png',
      naturalHeight: 1254,
      naturalWidth: 1254,
      objectFit: 'cover',
    };
    expect(selectedImageProblems(pilot, 'pilot', mount, 1)).toEqual([]);
    expect(selectedImageProblems(control, 'control', mount, 1)).toEqual([]);
    // Absent, undecoded, or sourceless elements fail in both arms.
    for (const arm of ['pilot', 'control']) {
      expect(selectedImageProblems(null, arm, mount)).toEqual([
        'selected image absent',
      ]);
      expect(
        selectedImageProblems({ ...pilot, complete: false }, arm, mount)
      ).toEqual(['selected image did not decode']);
      expect(
        selectedImageProblems({ ...pilot, naturalWidth: 0 }, arm, mount)
      ).toEqual(['selected image did not decode']);
      expect(
        selectedImageProblems({ ...pilot, currentSrc: '' }, arm, mount)
      ).toEqual(['selected image has no source']);
    }
    // Wrong-identity staged URLs fail: a stale generation on pilot, a
    // foreign original (or a derivative) on control.
    expect(
      selectedImageProblems(
        { ...pilot, currentSrc: 'https://lab/__pilot/stale/x.avif' },
        'pilot',
        mount
      )
    ).toEqual(['pilot selected is not from the approved generation']);
    expect(
      selectedImageProblems(
        { ...pilot, currentSrc: control.currentSrc },
        'pilot',
        mount
      )
    ).toEqual(['pilot selected is not from the approved generation']);
    expect(
      selectedImageProblems(
        { ...control, currentSrc: 'https://lab/other/x.png' },
        'pilot',
        mount
      )
    ).toEqual(['pilot selected is not from the approved generation']);
    expect(
      selectedImageProblems(
        {
          ...control,
          currentSrc: 'https://lab/__pilot/originals/other.png',
        },
        'control',
        mount
      )
    ).toEqual(['control selected is not the approved staged original']);
    expect(
      selectedImageProblems(
        { ...control, currentSrc: pilot.currentSrc },
        'control',
        mount
      )
    ).toEqual(['control selected is not the approved staged original']);
    // Loader params do not change identity: ?w&q still address the same
    // staged original.
    expect(
      selectedImageProblems(
        { ...control, currentSrc: `${control.currentSrc}?w=48&q=75` },
        'control',
        mount,
        1
      )
    ).toEqual([]);
  });

  it('rejects under-resolved images for the rendered box and DPR', () => {
    const mount = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/x.png',
    };
    const base = {
      box: { height: 300, width: 412 },
      complete: true,
      currentSrc: 'https://lab/__pilot/abc/x.avif',
      objectFit: 'cover',
    };
    // 412px box at DPR 3 needs 1236x900: a 928px-capped source fails even
    // though it decoded from the approved generation.
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 900, naturalWidth: 928 },
        'pilot',
        mount,
        3
      )
    ).toEqual([
      'selected image under-resolved: 928x900px serves a 412x300px box at DPR 3 (needs 1236x900px for cover)',
    ]);
    // Short on height alone still fails cover (both axes required).
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 800, naturalWidth: 1236 },
        'pilot',
        mount,
        3
      ).length
    ).toBe(1);
    // Exact coverage passes.
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 900, naturalWidth: 1236 },
        'pilot',
        mount,
        3
      )
    ).toEqual([]);
    // Contain needs only the constraining axis: a 2000x100 strip in a
    // 100x100 box renders sharp (downscaled), so it passes.
    expect(
      selectedImageProblems(
        {
          ...base,
          box: { height: 100, width: 100 },
          naturalHeight: 100,
          naturalWidth: 2000,
          objectFit: 'contain',
        },
        'pilot',
        mount,
        1
      )
    ).toEqual([]);
    // ...but a 50x50 contain image in a 100x100 box upscales 2x and fails.
    expect(
      selectedImageProblems(
        {
          ...base,
          box: { height: 100, width: 100 },
          naturalHeight: 50,
          naturalWidth: 50,
          objectFit: 'contain',
        },
        'pilot',
        mount,
        1
      ).length
    ).toBe(1);
    // Missing collection data fails loud, never silently sufficient.
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 900, naturalWidth: 1236, box: undefined },
        'pilot',
        mount,
        3
      )
    ).toEqual([
      'selected image resolution unverifiable (missing collection data)',
    ]);
  });

  it('judges w-descriptor srcsets by physical resource pixels', () => {
    const mount = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/x.png',
    };
    const base = {
      box: { height: 375, width: 384 },
      complete: true,
      currentSrc: 'https://lab/__pilot/abc/x.avif',
      objectFit: 'cover',
    };
    // 384px box at DPR 2 needs 768x750: naturalWidth 384 is the
    // density-corrected value, but the selected 768w resource covers it.
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 375, naturalWidth: 384, resourceWidth: 768 },
        'pilot',
        mount,
        2
      )
    ).toEqual([]);
    // A 384w resource for the same box genuinely under-resolves, and the
    // verdict names the resource it judged.
    expect(
      selectedImageProblems(
        { ...base, naturalHeight: 375, naturalWidth: 384, resourceWidth: 384 },
        'pilot',
        mount,
        2
      )
    ).toEqual([
      'selected image under-resolved: 384x375px (resource 384w) serves a 384x375px box at DPR 2 (needs 768x750px for cover)',
    ]);
  });
});

describe('merchant-image-pilot-readiness slot mounts', () => {
  const mount = {
    binding: 'merchant/logo-a',
    generationId: 'abc',
    merchantId: 'merchant',
    slotId: 'header-logo',
    stagedOriginal: '/__pilot/originals/x.png',
  };
  const pilotImg = {
    box: { height: 40, width: 40 },
    complete: true,
    currentSrc: 'https://lab/__pilot/abc/x.avif',
    naturalHeight: 80,
    naturalWidth: 80,
    objectFit: 'cover',
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

  it('fails absent, reported, hidden, and overflowing slots', () => {
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
    // gate even when the product card is green.
    expect(
      slotMountProblems(
        { ...goodSlot, rect: { height: 0, width: 0, x: 8, y: 8 } },
        mount,
        { arm: 'pilot', viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" has no visible box']);
    expect(
      slotMountProblems(
        { ...goodSlot, rect: { height: 40, width: 40, x: 380, y: 8 } },
        mount,
        { arm: 'pilot', viewportHeight: 844, viewportWidth: 390 }
      )
    ).toEqual(['slot "header-logo" overflows the viewport']);
    // Fully offscreen on any edge: nonzero boxes that still decode.
    for (const rect of [
      { height: 40, width: 40, x: -40, y: 8 },
      { height: 40, width: 40, x: 8, y: -40 },
      { height: 40, width: 40, x: 8, y: 844 },
      { height: 40, width: 40, x: 390, y: 8 },
    ]) {
      expect(
        slotMountProblems({ ...goodSlot, rect }, mount, {
          arm: 'pilot',
          viewportHeight: 844,
          viewportWidth: 390,
        })
      ).toEqual(['slot "header-logo" overflows the viewport']);
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

  it('validates every expected mount on the surface', () => {
    const card = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/card.png',
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
        devicePixelRatio: 2,
        gridDisplay: 'grid',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'cover',
        selected: { height: 300, width: 180, x: 8, y: 120 },
        selectedImg: pilotImg,
        slots: [goodSlot, cardSlot],
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

  it('inverts mobile-only mounts on desktop profiles', () => {
    const hero = {
      binding: 'merchant/hero-s0',
      merchantId: 'merchant',
      slotId: 'mobile-hero-slide-0',
    };
    const hidden = {
      binding: 'merchant/hero-s0',
      // Undecoded: a display:none image owes the gate no element verdict —
      // the mobile profiles own decode for this binding.
      img: { complete: false, currentSrc: '', naturalWidth: 0 },
      rect: { height: 0, width: 0, x: 0, y: 0 },
      slotId: 'mobile-hero-slide-0',
      status: null,
    };
    expect(
      slotMountProblems(hidden, hero, {
        arm: 'pilot',
        expectHidden: true,
        viewportHeight: 800,
        viewportWidth: 1280,
      })
    ).toEqual([]);
    // Absent and reported mounts still fail when hidden is expected.
    expect(
      slotMountProblems(null, hero, {
        arm: 'pilot',
        expectHidden: true,
        viewportHeight: 800,
        viewportWidth: 1280,
      })
    ).toEqual(['slot "mobile-hero-slide-0" mount is absent']);
    expect(
      slotMountProblems({ ...hidden, status: 'not-optimized' }, hero, {
        arm: 'pilot',
        expectHidden: true,
        viewportHeight: 800,
        viewportWidth: 1280,
      })
    ).toEqual(['slot "mobile-hero-slide-0" renders only "not-optimized"']);
    // A visible hero on a desktop profile breaks the responsive contract.
    expect(
      slotMountProblems(
        { ...hidden, rect: { height: 192, width: 390, x: 0, y: 0 } },
        hero,
        {
          arm: 'pilot',
          expectHidden: true,
          viewportHeight: 800,
          viewportWidth: 1280,
        }
      )
    ).toEqual(['slot "mobile-hero-slide-0" should be hidden on this profile']);
  });

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
  });

  it('rejects stale generations and foreign originals per slot', () => {
    const slot = {
      binding: 'merchant/logo-a',
      img: {
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
