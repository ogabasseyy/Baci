import { describe, expect, it } from 'vitest';
import { surfaceProblems } from './merchant-image-pilot-readiness-checks.mjs';

describe('surfaceProblems coverage binding', () => {
  const cardMount = {
    binding: 'merchant/card-a',
    generationId: 'abc',
    merchantId: 'merchant',
    slotId: 'product-card',
    stagedOriginal: '/__pilot/originals/card.png',
  };
  const logoMount = {
    binding: 'merchant/logo-a',
    generationId: 'abc',
    merchantId: 'merchant',
    slotId: 'header-logo',
    stagedOriginal: '/__pilot/originals/logo.png',
  };
  const imgFor = (currentSrc) => ({
    box: { height: 300, width: 180, x: 8, y: 8 },
    complete: true,
    currentSrc,
    naturalHeight: 384,
    naturalWidth: 384,
    objectFit: 'cover',
  });
  const slotFor = (mount, currentSrc) => ({
    binding: mount.binding,
    img: imgFor(currentSrc),
    rect: { height: 300, width: 180, x: 8, y: 8 },
    slotId: mount.slotId,
    status: null,
  });
  const collectedFor = (slots) => ({
    consoleErrors: [],
    failedRequests: [],
    geometry: {
      devicePixelRatio: 1,
      gridDisplay: 'grid',
      heading: { height: 1, width: 1 },
      imgObjectFit: 'cover',
      selected: { height: 100, width: 100, x: 0, y: 0 },
      selectedImg: imgFor('https://lab/__pilot/abc/card.avif'),
      slots,
      stylesheetBytes: 10,
      stylesheetCount: 1,
      viewportHeight: 600,
      viewportWidth: 800,
    },
    imageUrls: ['https://lab/__pilot/abc/card.avif'],
  });
  const base = {
    arm: 'pilot',
    expectHiddenMounts: false,
    expectNoAvif: false,
    expectedFit: 'cover',
    surface: 'grid',
  };
  const rendered = [
    slotFor(cardMount, 'https://lab/__pilot/abc/card.avif'),
    slotFor(logoMount, 'https://lab/__pilot/abc/logo.avif'),
  ];

  it('fails a rendered mount outside the expected set', () => {
    // A stale --mounts artifact omitting header-logo must not produce a
    // green report while the route renders an unchecked logo.
    const problems = surfaceProblems(collectedFor(rendered), {
      ...base,
      expectedMounts: [cardMount],
    });
    expect(problems.join('\n')).toMatch(
      /unexpected binding "merchant\/logo-a"/
    );
  });

  it('passes when every rendered mount is expected', () => {
    const problems = surfaceProblems(collectedFor(rendered), {
      ...base,
      expectedMounts: [cardMount, logoMount],
    });
    expect(problems).toEqual([]);
  });

  it('ignores reporting rows outside the expected set', () => {
    // A not-optimized row for an unaccepted binding is preflight's
    // verdict, not an unexpected mount.
    const rows = [
      ...rendered,
      {
        binding: 'merchant/unaccepted',
        img: null,
        rect: { height: 10, width: 10, x: 0, y: 0 },
        slotId: 'product-card',
        status: 'not-optimized',
      },
    ];
    const problems = surfaceProblems(collectedFor(rows), {
      ...base,
      expectedMounts: [cardMount, logoMount],
    });
    expect(problems).toEqual([]);
  });
});
