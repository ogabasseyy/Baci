import { describe, expect, it } from 'vitest';
import { addHiddenClass } from './review-handoff-class-merge';

describe('addHiddenClass', () => {
  it.each([
    ['<p hidden>', '<p hidden class="hidden">'],
    ['<p hidden/>', '<p hidden class="hidden"/>'],
    ['<p hidden class="note">', '<p hidden class="note hidden">'],
    ["<p hidden class='note'>", "<p hidden class='note hidden'>"],
    ['<p hidden class=note>', '<p hidden class="note hidden">'],
    ['<img hidden class=note/>', '<img hidden class="note hidden"/>'],
    [
      '<p hidden class=note title="x">',
      '<p hidden class="note hidden" title="x">',
    ],
    ['<p hidden CLASS="note">', '<p hidden class="note hidden">'],
    ['<p hidden classname=note>', '<p hidden classname=note class="hidden">'],
  ])('merges hidden without duplicating class: %s', (tag, expected) => {
    expect(addHiddenClass(tag)).toBe(expected);
  });
});
