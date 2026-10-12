import { describe, expect, it } from 'vitest';
import { stripHtmlComments } from './strip-html-comments';

describe('stripHtmlComments', () => {
  it.each([
    ['<!-- note -->Visible', 'Visible'],
    ['Visible<!-- note -->', 'Visible'],
    ['A<!-- one -->B<!-- two -->C', 'ABC'],
    ['<!-- <img src="http://example.com/draft.png"> -->Body', 'Body'],
    ['<!-- multi\nline\nnote -->Body', 'Body'],
    ['<!---->Body', 'Body'],
  ])('strips ordinary comments: %s', (input, expected) => {
    expect(stripHtmlComments(input)).toBe(expected);
  });

  it.each([
    'a <!- b',
    'a <-- b',
    '100 < !-- 200',
  ])('leaves comment-like text without an opener intact: %s', (input) => {
    expect(stripHtmlComments(input)).toBe(input);
  });

  it.each([
    ['Body<!-- <img src="http://x.test/a.png">', 'Body'],
    ['a < b <!-- c', 'a < b '],
  ])('strips an unterminated comment through the end of input: %s', (input, expected) => {
    // Per the HTML tokenizer, a comment runs to EOF when no closer
    // follows; browsers render none of it, so validators must not see
    // the draft markup hidden inside.
    expect(stripHtmlComments(input)).toBe(expected);
  });

  it.each([
    ['<!-->Body', 'Body'],
    ['A<!-->B', 'AB'],
    ['<!--->Body', 'Body'],
  ])('strips abruptly closed empty comments: %s', (input, expected) => {
    expect(stripHtmlComments(input)).toBe(expected);
  });

  it('strips a terminated comment before an unterminated one', () => {
    expect(stripHtmlComments('A<!-- one -->B<!-- two')).toBe('AB');
  });

  it('leaves a stray closer without an opener intact', () => {
    expect(stripHtmlComments('A --> B')).toBe('A --> B');
  });
});
