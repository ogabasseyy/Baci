import { describe, expect, it } from 'vitest';
import {
  boxesMatch,
  pilotImageUrlsOk,
  selectedImageProblems,
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
