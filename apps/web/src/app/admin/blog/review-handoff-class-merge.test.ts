import { describe, expect, it } from 'vitest';
import { addUtilityClass } from './review-handoff-class-merge';

describe('addUtilityClass', () => {
  it.each([
    ['<p hidden>', 'hidden', '<p hidden class="hidden">'],
    ['<p hidden/>', 'hidden', '<p hidden class="hidden"/>'],
    ['<p hidden class="note">', 'hidden', '<p hidden class="note hidden">'],
    ["<p hidden class='note'>", 'hidden', "<p hidden class='note hidden'>"],
    ['<p hidden class=note>', 'hidden', '<p hidden class="note hidden">'],
    ['<img hidden class=note/>', 'hidden', '<img hidden class="note hidden"/>'],
    [
      '<p hidden class=note title="x">',
      'hidden',
      '<p hidden class="note hidden" title="x">',
    ],
    ['<p hidden CLASS="note">', 'hidden', '<p hidden class="note hidden">'],
    [
      '<p hidden classname=note>',
      'hidden',
      '<p hidden classname=note class="hidden">',
    ],
    [
      '<p style="color:transparent">',
      'text-transparent',
      '<p style="color:transparent" class="text-transparent">',
    ],
  ])('merges utilities without duplicating class: %s', (tag, utility, expected) => {
    expect(addUtilityClass(tag, utility)).toBe(expected);
  });
});
