import { describe, expect, it } from 'vitest';
import { elementFrame } from './review-handoff-element-frame';
import { HidingStack } from './review-handoff-subtree-hidden';

const ALL_TRUE = [true, true, true, true, true, true];
const ALL_FALSE = [false, false, false, false, false, false];

function stackOf(...tags: string[]): HidingStack {
  const stack = new HidingStack();
  for (const tag of tags) stack.push(elementFrame(tag));
  return stack;
}

describe('HidingStack', () => {
  it('lets terminal hiding win anywhere in the chain', () => {
    const stack = stackOf('<div class="hidden">', '<p class="visible">');
    expect(stack.hiddenAt(false)).toEqual(ALL_TRUE);
    expect(stack.hiddenAt(true)).toEqual(ALL_TRUE);
  });

  it('lets the nearest visibility marker decide', () => {
    expect(
      stackOf('<div class="invisible">', '<p class="visible">').hiddenAt(false)
    ).toEqual(ALL_FALSE);
    expect(stackOf('<div class="invisible">').hiddenAt(false)).toEqual(
      ALL_TRUE
    );
  });

  it('consults color only for the text path', () => {
    const stack = stackOf('<div class="text-transparent">');
    expect(stack.hiddenAt(false)).toEqual(ALL_FALSE);
    expect(stack.hiddenAt(true)).toEqual(ALL_TRUE);
  });

  it('lets an opaque descendant escape a transparent ancestor', () => {
    const stack = stackOf(
      '<div class="text-transparent">',
      '<p class="text-black">'
    );
    expect(stack.hiddenAt(true)).toEqual(ALL_FALSE);
  });

  it('restores the parent verdict on pop', () => {
    const stack = stackOf('<div class="invisible">', '<p class="visible">');
    expect(stack.hiddenAt(false)).toEqual(ALL_FALSE);
    stack.pop();
    expect(stack.hiddenAt(false)).toEqual(ALL_TRUE);
    stack.pop();
    expect(stack.hiddenAt(true)).toEqual(ALL_FALSE);
  });
});
