import { describe, expect, it } from 'vitest';
import {
  hasReadableContent,
  stripHiddenContent,
} from './review-handoff-readability';

describe('hasReadableContent', () => {
  it.each([
    '<p>Visible body</p>',
    '<img src="https://cdn.example.com/a.png">',
    '<img class="text-transparent" src="https://cdn.example.com/a.png">',
    '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
    '<div class="hidden"></div><p>Visible body</p>',
    '<div class="invisible"><p class="visible">Readable</p></div>',
    '<div class="text-transparent"><p class="text-black">Readable</p></div>',
    '<div class="text-transparent"><p class="text-emerald-600">Readable</p></div>',
    '<div class="hidden md:block">Only body</div>',
    '<div class="invisible"><p class="md:visible">Readable</p></div>',
    '<div class="h-0 overflow-hidden md:h-auto">Only body</div>',
    '<div class="text-transparent"><p class="text-black/50">Readable</p></div>',
    '<img class="h-0 md:h-auto" src="https://cdn.example.com/a.png">',
    '<div class="text-transparent"><p class="text-foreground">Readable</p></div>',
    '<div class="hidden md:block lg:hidden">Readable</div>',
    '<p class="text-white text-transparent">Only body</p>',
    '<p class="text-black md:text-transparent">Only body</p>',
    '<p class="md:text-transparent">Only body</p>',
    '<p class="text-black text-inherit">Only body</p>',
    '<p class="bg-linear-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">Only body</p>',
    '<p class="bg-red-500 bg-clip-text text-transparent">Only body</p>',
    '<p class="md:bg-red-500 bg-clip-text text-transparent">Only body</p>',
    '<img class="max-h-0 min-h-screen" src="https://cdn.example.com/a.png">',
    '<img class="max-w-0 min-w-full" src="https://cdn.example.com/a.png">',
    '<div class="max-h-0 min-h-screen overflow-hidden">Only body</div>',
    '<div class="opacity-0 opacity-100">Only body</div>',
    '<div class="opacity-0 md:opacity-0 md:opacity-100">Only body</div>',
    '<img class="opacity-0 opacity-50" src="https://cdn.example.com/a.png">',
    '<div class="opacity-100 md:opacity-0">Only body</div>',
    '<div class="md:opacity-0">Only body</div>',
    '<div class="opacity-[0] md:opacity-100">Only body</div>',
    '<div class="scale-x-0 scale-x-100">Only body</div>',
    '<div class="scale-x-100 scale-x-0">Only body</div>',
    '<div class="scale-x-0 scale-none">Only body</div>',
    '<div class="scale-0 scale-none">Only body</div>',
    '<img width="0" class="w-auto" src="https://cdn.example.com/a.png">',
    '<img height="0" class="h-auto" src="https://cdn.example.com/a.png">',
    '<img width="0" height="0" class="size-auto" src="https://cdn.example.com/a.png">',
    '<img width="0" class="min-w-full" src="https://cdn.example.com/a.png">',
    '<div class="scale-x-0 md:scale-x-100">Only body</div>',
    '<div class="scale-y-0 md:scale-y-50">Only body</div>',
    '<div class="scale-x-0 md:scale-none">Only body</div>',
    '<img class="scale-0 md:scale-100" src="https://cdn.example.com/a.png">',
  ])('counts visible content as readable: %s', (content) => {
    expect(hasReadableContent(content)).toBe(true);
  });

  it.each([
    '',
    '<p>   </p>',
    '<img src="https://cdn.example.com/a.png" width="0" height="0">',
    '<img class="h-0" src="https://cdn.example.com/a.png">',
    '<img class="w-0" src="https://cdn.example.com/a.png">',
    '<img class="size-0" src="https://cdn.example.com/a.png">',
    '<img class="max-h-0" src="https://cdn.example.com/a.png">',
    '<img class="max-w-0" src="https://cdn.example.com/a.png">',
    '<img class="hidden" src="https://cdn.example.com/a.png">',
    '<div class="hidden"><img src="https://cdn.example.com/a.png"></div>',
    '<div class="hidden">Only body</div>',
    '<p class="text-transparent">Only body</p>',
    '<!-- <img src="https://cdn.example.com/a.png"> -->',
    '<!-- <p>Draft note</p> -->',
    `<div title="<img src='https://cdn.example.com/a.png'>"></div>`,
    '<div class="invisible"><div class="visible"><p class="invisible">Hidden</p></div></div>',
    '<div class="hidden"><p class="md:block">Hidden</p></div>',
    '<div class="opacity-0"><p class="md:opacity-100">Hidden</p></div>',
    '<div class="max-h-0 overflow-hidden md:h-auto">Hidden</div>',
    '<div class="text-transparent"><p class="text-black/0">Hidden</p></div>',
    '<img class="max-h-0 md:h-auto" src="https://cdn.example.com/a.png">',
    '<div class="hidden md:block md:hidden">Hidden</div>',
    '<img width="0" class="max-w-full" src="https://cdn.example.com/a.png">',
    '<img width="0" class="h-auto" src="https://cdn.example.com/a.png">',
    '<div class="scale-x-0">Only body</div>',
    '<div class="scale-0">Only body</div>',
    '<img class="scale-y-0" src="https://cdn.example.com/a.png">',
    '<div class="scale-x-0"><img src="https://cdn.example.com/a.png"></div>',
    '<div class="scale-x-0 md:scale-y-100">Hidden</div>',
    '<div class="scale-x-0 scale-x-[0]">Hidden</div>',
    '<div class="scale-0 scale-x-100">Hidden</div>',
    '<div class="scale-[0]">Hidden</div>',
    '<div class="scale-x-0 -scale-x-100">Hidden</div>',
    '<p class="bg-linear-to-r from-red-500 from-transparent to-transparent bg-clip-text text-transparent">Only body</p>',
    '<p class="text-black text-transparent">Only body</p>',
    '<p class="text-transparent md:text-black md:text-transparent">Only body</p>',
    '<p class="text-black/0">Only body</p>',
    '<p class="bg-clip-text text-transparent">Only body</p>',
    '<p class="bg-red-500 text-transparent">Only body</p>',
    '<p class="bg-transparent bg-clip-text text-transparent">Only body</p>',
    '<p class="bg-red-500/0 bg-clip-text text-transparent">Only body</p>',
    '<p class="bg-linear-to-r bg-clip-text text-transparent">Only body</p>',
    '<p class="bg-red-500 bg-transparent bg-clip-text text-transparent">Only body</p>',
    '<img class="max-h-0 min-h-0" src="https://cdn.example.com/a.png">',
    '<img class="max-h-0 h-screen" src="https://cdn.example.com/a.png">',
    '<div class="opacity-0">Only body</div>',
    '<div class="opacity-0 opacity-[0]">Only body</div>',
    '<div class="opacity-[0]">Only body</div>',
    '<p class="opacity-0 md:opacity-100 text-black md:text-transparent">Only body</p>',
    '<img class="opacity-[0]" src="https://cdn.example.com/a.png">',
    '<div class="opacity-0 md:opacity-0">Only body</div>',
  ])('disregards non-rendering content: %s', (content) => {
    expect(hasReadableContent(content)).toBe(false);
  });

  it('finds readable text after many images under a hidden ancestor', () => {
    // Ancestry is tracked in one document-order pass: hundreds of
    // hidden images must not rescan the article prefix each time.
    const images = '<img src="https://cdn.example.com/a.png">'.repeat(500);
    expect(
      hasReadableContent(`<div class="hidden">${images}</div><p>Tail</p>`)
    ).toBe(true);
    expect(hasReadableContent(`<div class="hidden">${images}</div>`)).toBe(
      false
    );
  });

  it.each([
    [
      '<p class="hidden">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    ['<div class="hidden"><p>Nested</p></div><p>Visible</p>', '<p>Visible</p>'],
    [
      '<img class="hidden" src="https://cdn.example.com/a.png"><p>Visible</p>',
      '<p>Visible</p>',
    ],
    [
      '<div class="hidden md:block">Shown</div>',
      '<div class="hidden md:block">Shown</div>',
    ],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
  ])('strips only always-hidden subtrees: %s', (content, expected) => {
    expect(stripHiddenContent(content)).toBe(expected);
  });

  it('finds a visible image after many hidden sibling images', () => {
    const hidden =
      '<div class="hidden"><img src="https://cdn.example.com/a.png"></div>'.repeat(
        200
      );
    expect(
      hasReadableContent(`${hidden}<img src="https://cdn.example.com/b.png">`)
    ).toBe(true);
  });
});
