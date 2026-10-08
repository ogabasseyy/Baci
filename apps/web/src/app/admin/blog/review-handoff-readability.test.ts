import { describe, expect, it } from 'vitest';
import { hasReadableContent } from './review-handoff-readability';

describe('hasReadableContent', () => {
  it.each([
    '<p>Visible body</p>',
    '<img src="https://cdn.example.com/a.png">',
    '<img class="text-transparent" src="https://cdn.example.com/a.png">',
    '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
    '<div class="hidden"></div><p>Visible body</p>',
    '<div class="invisible"><p class="visible">Readable</p></div>',
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
  ])('disregards non-rendering content: %s', (content) => {
    expect(hasReadableContent(content)).toBe(false);
  });
});
