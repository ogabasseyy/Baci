import { describe, expect, it } from 'vitest';
import { noAvifSurfaceProblems } from './merchant-image-pilot-readiness-noavif.mjs';

describe('no-avif fallback proof', () => {
  const base = {
    imageUrls: ['https://lab/__pilot/abc/x.webp'],
    strippedAvif: 3,
  };

  it('passes a pilot run that stripped, avoided AVIF, and fetched WebP', () => {
    expect(noAvifSurfaceProblems(base, 'pilot')).toEqual([]);
  });

  it('ignores the control arm (unstripped Chrome baseline)', () => {
    expect(noAvifSurfaceProblems({ imageUrls: [] }, 'control')).toEqual([]);
  });

  it('fails a vacuous run that stripped no AVIF candidates', () => {
    expect(
      noAvifSurfaceProblems({ ...base, strippedAvif: 0 }, 'pilot')
    ).toEqual(['no-avif run stripped no AVIF candidates']);
  });

  it('fails AVIF bytes fetched past the strip', () => {
    expect(
      noAvifSurfaceProblems(
        {
          ...base,
          imageUrls: [
            'https://lab/__pilot/abc/x.webp',
            'https://lab/__pilot/abc/x.avif',
          ],
        },
        'pilot'
      )
    ).toEqual([
      'no-avif run fetched AVIF bytes: https://lab/__pilot/abc/x.avif',
    ]);
  });

  it('fails a run that fetched no WebP fallback', () => {
    expect(noAvifSurfaceProblems({ ...base, imageUrls: [] }, 'pilot')).toEqual([
      'no-avif run fetched no WebP fallback',
    ]);
  });
});
