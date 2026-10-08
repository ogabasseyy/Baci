import { describe, expect, it } from 'vitest';
import { stripHiddenContent } from './review-handoff-strip-hidden';

describe('stripHiddenContent', () => {
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
    [
      '<p class="invisible">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    [
      '<p class="text-transparent">Draft note</p><p>Visible article</p>',
      '<p>Visible article</p>',
    ],
    [
      '<div class="invisible"><p>Note</p><p class="visible">Keep</p></div>',
      '<div class="invisible"><p class="visible">Keep</p></div>',
    ],
    [
      '<div class="invisible">Direct text<p class="visible">Keep</p></div>',
      '<div class="invisible"><p class="visible">Keep</p></div>',
    ],
    [
      '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
      '<div class="text-transparent"><img src="https://cdn.example.com/a.png"></div>',
    ],
    [
      '<img class="invisible" src="https://cdn.example.com/a.png"><p>V</p>',
      '<p>V</p>',
    ],
    [
      '<p class="invisible md:visible">Note</p>',
      '<p class="invisible md:visible">Note</p>',
    ],
    ['<p>Untouched</p>', '<p>Untouched</p>'],
  ])('strips only always-hidden subtrees: %s', (content, expected) => {
    expect(stripHiddenContent(content)).toBe(expected);
  });
});
