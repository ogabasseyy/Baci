import { describe, expect, it } from 'vitest';
import { resolutionProblems } from './merchant-image-pilot-readiness-resolution.mjs';

const COVER = {
  box: { height: 375, width: 384 },
  complete: true,
  currentSrc: 'https://lab/__pilot/abc/x.avif',
  naturalHeight: 750,
  naturalWidth: 768,
  objectFit: 'cover',
};

describe('resolutionProblems', () => {
  it('passes physical pixels that cover the box at DPR', () => {
    expect(resolutionProblems(COVER, 'selected image', 2)).toEqual([]);
  });

  it('fails cover images short on either axis', () => {
    expect(
      resolutionProblems({ ...COVER, naturalHeight: 749 }, 'selected image', 2)
    ).toEqual([
      'selected image under-resolved: 768x749px serves a 384x375px box at DPR 2 (needs 768x750px for cover)',
    ]);
  });

  it('passes contain images that satisfy the constraining axis', () => {
    const contain = { ...COVER, objectFit: 'contain', naturalWidth: 100 };
    expect(resolutionProblems(contain, 'selected image', 2)).toEqual([]);
    expect(
      resolutionProblems(
        { ...contain, naturalHeight: 100 },
        'selected image',
        2
      )
    ).toEqual([
      'selected image under-resolved: 100x100px serves a 384x375px box at DPR 2 (needs 768x750px for contain)',
    ]);
  });

  it('judges w-descriptor srcsets by the selected resource width', () => {
    const densityCorrected = {
      ...COVER,
      naturalHeight: 375,
      naturalWidth: 384,
      resourceWidth: 768,
    };
    expect(resolutionProblems(densityCorrected, 'selected image', 2)).toEqual(
      []
    );
    expect(
      resolutionProblems(
        { ...densityCorrected, resourceWidth: 384 },
        'selected image',
        2
      )
    ).toEqual([
      'selected image under-resolved: 384x375px (resource 384w) serves a 384x375px box at DPR 2 (needs 768x750px for cover)',
    ]);
  });

  it('fails closed on missing collection data and unmeasurable boxes', () => {
    expect(
      resolutionProblems({ ...COVER, objectFit: undefined }, 'slot "a"', 2)
    ).toEqual(['slot "a" resolution unverifiable (missing collection data)']);
    expect(
      resolutionProblems(
        { ...COVER, box: { height: 0, width: 0 } },
        'slot "a"',
        2
      )
    ).toEqual(['slot "a" has no measurable box']);
  });
});
