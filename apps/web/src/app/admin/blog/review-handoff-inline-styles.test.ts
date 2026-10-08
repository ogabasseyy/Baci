import { describe, expect, it } from 'vitest';
import { convertHiddenInlineStyles } from './review-handoff-inline-styles';

describe('convertHiddenInlineStyles', () => {
  it.each([
    [
      '<p style="display:none">Draft note</p><p>Visible article</p>',
      '<p style="display:none" class="hidden">Draft note</p><p>Visible article</p>',
    ],
    [
      '<p style="DISPLAY: NONE !important">Note</p>',
      '<p style="DISPLAY: NONE !important" class="hidden">Note</p>',
    ],
    [
      '<p style="color:red; visibility:hidden; margin:0">Note</p>',
      '<p style="color:red; visibility:hidden; margin:0" class="hidden">Note</p>',
    ],
    [
      '<p style="visibility:collapse">Note</p>',
      '<p style="visibility:collapse" class="hidden">Note</p>',
    ],
    [
      '<p style="opacity:0">Note</p>',
      '<p style="opacity:0" class="hidden">Note</p>',
    ],
    [
      '<p style="opacity: 0.0">Note</p>',
      '<p style="opacity: 0.0" class="hidden">Note</p>',
    ],
    [
      '<p class="note" style="display:none">Note</p>',
      '<p class="note hidden" style="display:none">Note</p>',
    ],
  ])('converts hiding inline styles to hiding classes: %s', (html, expected) => {
    expect(convertHiddenInlineStyles(html)).toBe(expected);
  });

  it.each([
    '<p style="display:block">Shown</p>',
    '<p style="visibility:visible">Shown</p>',
    '<p style="opacity:1">Shown</p>',
    '<p style="opacity:">Shown</p>',
    '<p style="color:red">Shown</p>',
    '<p style="display:none-2x">Shown</p>',
    '<p>No style</p>',
  ])('leaves non-hiding styles alone: %s', (html) => {
    expect(convertHiddenInlineStyles(html)).toBe(html);
  });
});
