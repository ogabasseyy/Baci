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
