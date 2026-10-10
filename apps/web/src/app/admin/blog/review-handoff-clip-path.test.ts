import { describe, expect, it } from 'vitest';
import { isZeroAreaClipPath } from './review-handoff-clip-path';

describe('isZeroAreaClipPath', () => {
  it.each([
    'circle(0)',
    'circle(0px)',
    'circle(0% at 50% 50%)',
    'CIRCLE(0)',
    'ellipse(0 0)',
    'ellipse(10px 0)',
    'ellipse(0 5%)',
    'inset(50%)',
    'inset(100% 0 0 0)',
    'inset(0 0 100% 0)',
    'inset(60% 60%)',
    'inset(50% round 4px)',
    'polygon(0 0, 0 0, 0 0)',
    'polygon(evenodd 10% 10%, 10% 10%, 10% 10%)',
  ])('flags zero-area clipping: %s', (value) => {
    expect(isZeroAreaClipPath(value)).toBe(true);
  });

  it.each([
    'none',
    '',
    'circle(50%)',
    'circle(closest-side)',
    'circle()',
    'ellipse(10px 5px)',
    'ellipse(0)',
    'inset(10%)',
    'inset(10px 10px 10px 10px)',
    'inset(49% 49% 49% 49%)',
    'inset()',
    'polygon(0 0, 100% 0, 100% 100%)',
    'polygon(0 0, 0 0)',
    'path("M0,0 L10,10")',
    'url(#clip)',
    'margin-box',
    'not-a-function',
  ])('leaves visible paths alone: %s', (value) => {
    expect(isZeroAreaClipPath(value)).toBe(false);
  });
});
