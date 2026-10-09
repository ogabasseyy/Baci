import { describe, expect, it } from 'vitest';
import { parseHandoffDom } from './review-handoff-dom';
import { elementFrame } from './review-handoff-element-frame';

const ALL_TRUE = [true, true, true, true, true, true];
const ALL_FALSE = [false, false, false, false, false, false];
const ALL_NULL = [null, null, null, null, null, null];

function frameOf(tag: string) {
  const element = parseHandoffDom(tag).body.firstElementChild;
  if (!element) throw new Error(`no element parsed from ${tag}`);
  return elementFrame(element);
}

describe('elementFrame', () => {
  it('reports terminal hiding without inherited markers', () => {
    expect(frameOf('<div class="hidden">')).toEqual({
      terminalAt: ALL_TRUE,
      visibilityAt: ALL_NULL,
      colorAt: ALL_NULL,
    });
  });

  it('reports responsive terminal hiding per point', () => {
    expect(frameOf('<div class="hidden md:block">').terminalAt).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('reports inherited markers without terminal hiding', () => {
    const frame = frameOf('<div class="invisible text-transparent">');
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
    expect(frameOf('<div>')).toEqual({
      terminalAt: ALL_FALSE,
      visibilityAt: ALL_NULL,
      colorAt: ALL_NULL,
    });
  });
});
