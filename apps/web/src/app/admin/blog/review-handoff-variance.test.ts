import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
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

  it.each([
    '<p class="max-[600px]:hidden">Mobile note</p><p>Body</p>',
    '<p class="min-[1000px]:invisible">Wide note</p><p>Body</p>',
    '<p class="supports-[display:grid]:opacity-0">Note</p><p>Body</p>',
    '<p class="md:max-[600px]:hidden">Note</p><p>Body</p>',
    '<p class="hidden max-[600px]:block">Note</p><p>Body</p>',
    '<p class="first:hidden">Note</p><p>Body</p>',
    '<p class="portrait:hidden">Note</p><p>Body</p>',
    '<p class="data-[state=open]:hidden">Note</p><p>Body</p>',
    '<p class="max-[600px]:text-red-500">Note</p><p>Body</p>',
  ])('rejects unsupported variants wrapping visibility utilities: %s', (content) => {
    expect(hasUnrepresentableVariance(content)).toBe(true);
  });

  it.each([
    '<p class="hover:hidden">Note</p><p>Body</p>',
    '<p class="md:hover:hidden">Note</p><p>Body</p>',
    '<p class="group-hover:hidden">Note</p><p>Body</p>',
    '<p class="print:hidden">Note</p><p>Body</p>',
    '<p class="max-[600px]:p-4">Note</p><p>Body</p>',
  ])('accepts at-rest-neutral or non-hiding variants: %s', (content) => {
    expect(hasUnrepresentableVariance(content)).toBe(false);
  });

  it('rejects arbitrary responsive hiding at import', () => {
    expect(() =>
      validateImportedContent(
        '<p class="max-[600px]:hidden">Mobile note</p><p>Body</p>'
      )
    ).toThrow('responsive visibility');
  });

  it('evaluates deeply nested markup in linear time', {
    timeout: 15000,
  }, () => {
    // Same incremental ancestry walk as readability: uniform
    // responsive markers must scan once, not once per ancestor.
    const depth = 18000;
    const open = '<div class="md:block">'.repeat(depth);
    const close = '</div>'.repeat(depth);
    expect(hasUnrepresentableVariance(`${open}Deep${close}`)).toBe(false);
  });
});
