import { describe, expect, it } from 'vitest';
import { elementFrame } from './review-handoff-element-frame';

const ALL_TRUE = [true, true, true, true, true, true];
const ALL_FALSE = [false, false, false, false, false, false];
const ALL_NULL = [null, null, null, null, null, null];

describe('elementFrame', () => {
  it('reports terminal hiding without inherited markers', () => {
    expect(elementFrame('<div class="hidden">')).toEqual({
      terminalAt: ALL_TRUE,
      visibilityAt: ALL_NULL,
      colorAt: ALL_NULL,
    });
  });

  it('reports responsive terminal hiding per point', () => {
    expect(elementFrame('<div class="hidden md:block">').terminalAt).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('reports inherited markers without terminal hiding', () => {
    const frame = elementFrame('<div class="invisible text-transparent">');
    expect(frame.terminalAt).toEqual(ALL_FALSE);
    expect(frame.visibilityAt).toEqual([
      'invisible',
      'invisible',
      'invisible',
      'invisible',
      'invisible',
      'invisible',
    ]);
    expect(frame.colorAt).toEqual([
      'transparent',
      'transparent',
      'transparent',
      'transparent',
      'transparent',
      'transparent',
    ]);
  });

  it('reports no markers without a class attribute', () => {
    expect(elementFrame('<div>')).toEqual({
      terminalAt: ALL_FALSE,
      visibilityAt: ALL_NULL,
      colorAt: ALL_NULL,
    });
  });
});
