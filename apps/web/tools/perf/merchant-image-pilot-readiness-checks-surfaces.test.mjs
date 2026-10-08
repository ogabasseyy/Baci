import { describe, expect, it } from 'vitest';
import {
  slotMountProblems,
  surfaceProblems,
} from './merchant-image-pilot-readiness-checks.mjs';
import {
  goodSlot,
  mount,
  pilotImg,
} from './merchant-image-pilot-readiness-checks-fixtures.mjs';

describe('merchant-image-pilot-readiness surfaces', () => {
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
    // Visibility reads the mount image box, never the section rect.
    const broken = {
      ...collected,
      geometry: {
        ...collected.geometry,
        slots: [
          {
            ...goodSlot,
            img: {
              ...pilotImg,
              box: { height: 0, width: 0, x: 0, y: 0 },
            },
          },
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
    // A twin section for the same binding fails even though the first
    // match is perfect: first-match lookup would otherwise let the
    // duplicate alter layout or fetch unvalidated.
    const duped = {
      ...collected,
      geometry: {
        ...collected.geometry,
        slots: [goodSlot, { ...goodSlot }, cardSlot],
      },
    };
    expect(
      surfaceProblems(duped, {
        arm: 'pilot',
        expectedFit: 'cover',
        expectedMounts: [mount, card],
        surface: 'grid',
      })
    ).toEqual([
      'slot "header-logo" renders 2 sections for one binding (duplicate mount)',
    ]);
  });

  it('requires WebP selection on the no-avif profile', () => {
    const webpImg = {
      ...pilotImg,
      currentSrc: 'https://lab/__pilot/abc/x.webp',
    };
    // Painted WebP from the approved generation: fallback verified.
    expect(
      slotMountProblems({ ...goodSlot, img: webpImg }, mount, {
        arm: 'pilot',
        dpr: 2,
        expectNoAvif: true,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([]);
    // Painted AVIF despite the strip: the fallback was never selected.
    expect(
      slotMountProblems(goodSlot, mount, {
        arm: 'pilot',
        dpr: 2,
        expectNoAvif: true,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual(['pilot slot "header-logo" image selected AVIF despite no-avif']);
    // Same AVIF paint on a standard profile: no fallback expected.
    expect(
      slotMountProblems(goodSlot, mount, {
        arm: 'pilot',
        dpr: 2,
        viewportHeight: 844,
        viewportWidth: 390,
      })
    ).toEqual([]);
  });

  it('proves the no-avif fallback non-vacuously at the surface level', () => {
    const webpImg = {
      ...pilotImg,
      currentSrc: 'https://lab/__pilot/abc/x.webp',
    };
    const card = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/card.png',
    };
    const cardSlot = {
      binding: 'merchant/card-a',
      img: webpImg,
      rect: { height: 300, width: 180, x: 8, y: 120 },
      slotId: 'product-card',
      status: null,
    };
    const base = {
      consoleErrors: [],
      failedRequests: [],
      geometry: {
        devicePixelRatio: 2,
        gridDisplay: 'grid',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'cover',
        selected: { height: 300, width: 180, x: 8, y: 120 },
        avifCandidates: 3,
        selectedImg: webpImg,
        slots: [{ ...goodSlot, img: webpImg }, cardSlot],
        stylesheetBytes: 1200,
        stylesheetCount: 1,
        viewportHeight: 844,
        viewportWidth: 390,
      },
      imageUrls: ['https://lab/__pilot/abc/x.webp'],
      avifDisabled: true,
    };
    const options = {
      arm: 'pilot',
      expectNoAvif: true,
      expectedFit: 'cover',
      expectedMounts: [mount, card],
      surface: 'grid',
    };
    expect(surfaceProblems(base, options)).toEqual([]);
    // No retained candidates: the page had no AVIF to fall back from.
    expect(
      surfaceProblems(
        { ...base, geometry: { ...base.geometry, avifCandidates: 0 } },
        options
      )
    ).toEqual(['no-avif run has no retained AVIF candidates']);
    // AVIF bytes still fetched: unsupported format was requested.
    expect(
      surfaceProblems(
        {
          ...base,
          imageUrls: [
            'https://lab/__pilot/abc/x.webp',
            'https://lab/__pilot/abc/x.avif',
          ],
        },
        options
      )
    ).toEqual([
      'no-avif run fetched AVIF bytes: https://lab/__pilot/abc/x.avif',
    ]);
    // No WebP fetched: nothing proves the fallback painted.
    expect(surfaceProblems({ ...base, imageUrls: [] }, options)).toEqual([
      'no-avif run fetched no WebP fallback',
    ]);
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
    // Visibility reads the mount image box, never the section.
    expect(
      slotMountProblems(
        {
          ...hidden,
          img: {
            ...hidden.img,
            box: { height: 192, width: 390, x: 0, y: 0 },
          },
        },
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
});
