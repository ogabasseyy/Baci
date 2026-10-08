import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
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
    [
      '<p style="color:transparent">Draft note</p><p>Visible article</p>',
      '<p style="color:transparent" class="text-transparent">Draft note</p><p>Visible article</p>',
    ],
    [
      '<p style="COLOR: TRANSPARENT !important">Note</p>',
      '<p style="COLOR: TRANSPARENT !important" class="text-transparent">Note</p>',
    ],
    [
      '<p style="color:rgba(0,0,0,0)">Note</p>',
      '<p style="color:rgba(0,0,0,0)" class="text-transparent">Note</p>',
    ],
    [
      '<p style="color:rgb(0 0 0 / 0)">Note</p>',
      '<p style="color:rgb(0 0 0 / 0)" class="text-transparent">Note</p>',
    ],
    [
      '<p style="-webkit-text-fill-color:transparent">Note</p>',
      '<p style="-webkit-text-fill-color:transparent" class="text-transparent">Note</p>',
    ],
    [
      '<p style="color:red;color:transparent">Note</p>',
      '<p style="color:red;color:transparent" class="text-transparent">Note</p>',
    ],
    [
      '<p style="font-size:0">Draft note</p><p>Visible article</p>',
      '<p style="font-size:0" class="text-transparent">Draft note</p><p>Visible article</p>',
    ],
    [
      '<p style="font-size:0px">Note</p>',
      '<p style="font-size:0px" class="text-transparent">Note</p>',
    ],
    [
      '<p style="font-size: 0.0em">Note</p>',
      '<p style="font-size: 0.0em" class="text-transparent">Note</p>',
    ],
    [
      '<p style="transform:scale(0)">Draft note</p><p>Visible article</p>',
      '<p style="transform:scale(0)" class="hidden">Draft note</p><p>Visible article</p>',
    ],
    [
      '<p style="transform: translateX(5px) scale(1, 0)">Note</p>',
      '<p style="transform: translateX(5px) scale(1, 0)" class="hidden">Note</p>',
    ],
    [
      '<p style="transform:scaleX(0)">Note</p>',
      '<p style="transform:scaleX(0)" class="hidden">Note</p>',
    ],
    [
      '<p style="transform:scale3d(0, 1, 1)">Note</p>',
      '<p style="transform:scale3d(0, 1, 1)" class="hidden">Note</p>',
    ],
    [
      '<p style="transform:matrix(0, 0, 0, 1, 0, 0)">Note</p>',
      '<p style="transform:matrix(0, 0, 0, 1, 0, 0)" class="hidden">Note</p>',
    ],
    [
      '<p style="transform:matrix3d(0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)">Note</p>',
      '<p style="transform:matrix3d(0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)" class="hidden">Note</p>',
    ],
    [
      '<p style="scale:0">Note</p>',
      '<p style="scale:0" class="hidden">Note</p>',
    ],
    [
      '<p style="filter:opacity(0)">Draft note</p><p>Body</p>',
      '<p style="filter:opacity(0)" class="hidden">Draft note</p><p>Body</p>',
    ],
    [
      '<p style="filter: blur(2px) opacity(0%)">Note</p>',
      '<p style="filter: blur(2px) opacity(0%)" class="hidden">Note</p>',
    ],
    [
      '<p style="opacity:0%">Note</p>',
      '<p style="opacity:0%" class="hidden">Note</p>',
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
    '<p style="color:rgba(0,0,0,1)">Shown</p>',
    '<p style="color:rgb(0,0,0)">Shown</p>',
    '<p style="display:none-2x">Shown</p>',
    '<p style="display:none;display:block">Shown</p>',
    '<p style="opacity:0;opacity:1">Shown</p>',
    '<p style="visibility:hidden;visibility:visible">Shown</p>',
    '<p style="color:transparent;color:red">Shown</p>',
    '<p style="color:transparent;-webkit-text-fill-color:red">Shown</p>',
    '<p style="font-size:16px">Shown</p>',
    '<p style="font-size:medium">Shown</p>',
    '<p style="font-size:0abc">Shown</p>',
    '<p style="font-size:-1px">Shown</p>',
    '<p style="font-size:0;font-size:16px">Shown</p>',
    '<p style="transform:translateX(5px)">Shown</p>',
    '<p style="transform:scale(1)">Shown</p>',
    '<p style="transform:scaleZ(0)">Shown</p>',
    '<p style="transform:scale3d(1, 1, 0)">Shown</p>',
    '<p style="transform:matrix(1, 0, 0, 1, 0, 0)">Shown</p>',
    '<p style="transform:scale(0, foo)">Shown</p>',
    '<p style="scale:1">Shown</p>',
    '<p style="transform:scale(0);transform:none">Shown</p>',
    '<p style="filter:opacity(0.5)">Shown</p>',
    '<p style="filter:brightness(0)">Shown</p>',
    '<p style="filter:blur(8px)">Shown</p>',
    '<p style="filter:none">Shown</p>',
    '<p style="filter:opacity()">Shown</p>',
    '<p style="filter:opacity(0);filter:none">Shown</p>',
    '<p style="opacity:50%">Shown</p>',
    '<p>No style</p>',
  ])('leaves non-hiding styles alone: %s', (html) => {
    expect(convertHiddenInlineStyles(html)).toBe(html);
  });

  it('strips transparent inline text while keeping its images', () => {
    // Transparent color hides glyphs only: decoded image pixels still
    // render, so conversion must use text-transparent, not hidden.
    const stored = validateImportedContent(
      '<p style="color:transparent">Draft note<img src="https://cdn.example.com/a.png"></p><p>Visible article</p>'
    );
    expect(stored).not.toContain('Draft note');
    expect(stored).toContain('https://cdn.example.com/a.png');
  });

  it('strips zero-size inline text at import', () => {
    expect(
      validateImportedContent(
        '<p style="font-size:0">Draft note</p><p>Visible article</p>'
      )
    ).toBe('<p>Visible article</p>');
  });

  it('strips zero-scale inline content at import', () => {
    expect(
      validateImportedContent(
        '<p style="transform:scale(0)">Draft note</p><p>Visible article</p>'
      )
    ).toBe('<p>Visible article</p>');
  });

  it('strips zero-opacity filter content at import', () => {
    expect(
      validateImportedContent(
        '<p style="filter:opacity(0)">Draft note</p><p>Body</p>'
      )
    ).toBe('<p>Body</p>');
  });
});
