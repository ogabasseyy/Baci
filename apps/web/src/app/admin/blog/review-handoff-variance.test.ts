import { describe, expect, it } from 'vitest';
import { hasUnrepresentableVariance } from './review-handoff-variance';

describe('hasUnrepresentableVariance', () => {
  it.each([
    '<p class="hidden md:block">Desktop note</p>',
    '<div class="opacity-0 lg:opacity-100">Only body</div>',
    '<div class="invisible sm:visible">Only body</div>',
    '<div class="sr-only md:not-sr-only">Only body</div>',
    '<div class="h-0 overflow-hidden md:h-auto">Only body</div>',
    '<div class="invisible"><p class="md:visible">Only body</p></div>',
    '<div class="text-transparent"><p class="md:text-black">Only body</p></div>',
    '<p class="hidden dark:block">Dark note</p>',
    '<img class="h-0 md:h-auto" src="https://cdn.example.com/a.png">',
    '<img class="md:w-full" src="https://cdn.example.com/a.png" width="0">',
  ])('flags viewport- or theme-dependent hiding: %s', (content) => {
    expect(hasUnrepresentableVariance(content)).toBe(true);
  });

  it.each([
    '<p>Visible article</p>',
    'plain text without any markup',
    '<p class="hidden">Gone</p><p>Visible article</p>',
    '<div class="hidden dark:hidden">Nowhere</div>',
    '<p class="md:block">Desktop note</p>',
    '<div class="text-transparent"><p class="text-black">Readable</p></div>',
    '<div class="invisible"><p class="visible">Escaped</p></div>',
    '<img src="https://cdn.example.com/a.png">',
    '<!-- <p class="hidden md:block">Commented out</p> --><p>Kept</p>',
  ])('accepts uniformly hidden, shown, or non-hiding markup: %s', (content) => {
    expect(hasUnrepresentableVariance(content)).toBe(false);
  });
});
