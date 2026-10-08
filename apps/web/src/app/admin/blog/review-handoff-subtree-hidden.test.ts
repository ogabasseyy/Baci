import { describe, expect, it } from 'vitest';
import { elementFrame } from './review-handoff-element-frame';
import { subtreeHiddenAt } from './review-handoff-subtree-hidden';

const ALL_TRUE = [true, true, true, true, true, true];
const ALL_FALSE = [false, false, false, false, false, false];

describe('subtreeHiddenAt', () => {
  it('lets terminal hiding win anywhere in the chain', () => {
    const frames = [
      elementFrame('<div class="hidden">'),
      elementFrame('<p class="visible">'),
    ];
    expect(subtreeHiddenAt(frames, false)).toEqual(ALL_TRUE);
    expect(subtreeHiddenAt(frames, true)).toEqual(ALL_TRUE);
  });

  it('lets the nearest visibility marker decide', () => {
    const frames = [
      elementFrame('<div class="invisible">'),
      elementFrame('<p class="visible">'),
    ];
    expect(subtreeHiddenAt(frames, false)).toEqual(ALL_FALSE);
    expect(
      subtreeHiddenAt([elementFrame('<div class="invisible">')], false)
    ).toEqual(ALL_TRUE);
  });

  it('consults color only for the text path', () => {
    const frames = [elementFrame('<div class="text-transparent">')];
    expect(subtreeHiddenAt(frames, false)).toEqual(ALL_FALSE);
    expect(subtreeHiddenAt(frames, true)).toEqual(ALL_TRUE);
  });

  it('lets an opaque descendant escape a transparent ancestor', () => {
    const frames = [
      elementFrame('<div class="text-transparent">'),
      elementFrame('<p class="text-black">'),
    ];
    expect(subtreeHiddenAt(frames, true)).toEqual(ALL_FALSE);
  });
});
