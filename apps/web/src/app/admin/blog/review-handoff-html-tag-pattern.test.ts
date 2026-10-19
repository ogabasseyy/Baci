import { describe, expect, it } from 'vitest';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';

describe('HTML_TAG_PATTERN', () => {
  it('matches open and close tags', () => {
    const tags = [...'<div><p>x</p></div>'.matchAll(HTML_TAG_PATTERN)].map(
      (match) => match[0]
    );
    expect(tags).toEqual(['<div>', '<p>', '</p>', '</div>']);
  });

  it('matches quoted attributes containing angle brackets', () => {
    const tags = [
      ...'<img src="a>b.png" alt=\'x\'>'.matchAll(HTML_TAG_PATTERN),
    ].map((match) => match[0]);
    expect(tags).toEqual(['<img src="a>b.png" alt=\'x\'>']);
  });

  it('does not match the comment opener itself', () => {
    // Tag-like text inside a comment body still matches — which is
    // why callers strip comments before matching.
    const matches = [...'<!-- <p>x</p> -->'.matchAll(HTML_TAG_PATTERN)];
    expect(matches.map((match) => match.index)).toEqual([5, 9]);
  });
});
