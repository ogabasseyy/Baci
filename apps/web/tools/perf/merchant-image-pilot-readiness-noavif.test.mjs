import { describe, expect, it } from 'vitest';
import { noAvifSurfaceProblems } from './merchant-image-pilot-readiness-noavif.mjs';

describe('no-avif fallback proof', () => {
  const base = {
    imageUrls: ['https://lab/__pilot/abc/x.webp'],
    avifDisabled: true,
    geometry: { avifCandidates: 3 },
  };

  it('passes a pilot run that retained candidates, avoided AVIF, and fetched WebP', () => {
    expect(noAvifSurfaceProblems(base, 'pilot')).toEqual([]);
  });

  it('ignores the control arm (normal Chrome baseline)', () => {
    expect(noAvifSurfaceProblems({ imageUrls: [] }, 'control')).toEqual([]);
  });

  it('fails a vacuous run that has no AVIF candidates', () => {
    expect(
      noAvifSurfaceProblems(
        { ...base, geometry: { avifCandidates: 0 } },
        'pilot'
      )
    ).toEqual(['no-avif run has no retained AVIF candidates']);
  });

  it('fails AVIF bytes fetched despite disabled support', () => {
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

  it('requires confirmed browser emulation', () => {
    expect(
      noAvifSurfaceProblems({ ...base, avifDisabled: false }, 'pilot')
    ).toEqual(['no-avif run did not confirm browser format emulation']);
  });

  it('fails a run that fetched no WebP fallback', () => {
    expect(noAvifSurfaceProblems({ ...base, imageUrls: [] }, 'pilot')).toEqual([
      'no-avif run fetched no WebP fallback',
    ]);
  });
});
