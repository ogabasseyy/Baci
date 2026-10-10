import { describe, expect, it } from 'vitest';
import { hasBrokenMediaTag } from './review-handoff-media-validation';

describe('hasBrokenMediaTag', () => {
  it.each([
    '<img src="https://cdn.example.com/a.png">',
    '<picture><source srcset="https://cdn.example.com/a.webp"><img src="https://cdn.example.com/a.png"></picture>',
    '<p>No media here</p>',
    '<picture><source type="text/plain" srcset="https://cdn.example.com/a.txt"></picture>',
  ])('accepts importable or inert media: %s', (html) => {
    expect(hasBrokenMediaTag(html)).toBe(false);
  });

  it.each([
    '<img src="http://cdn.example.com/a.png">',
    '<img src="data:image/png;base64,AAAA">',
    '<img alt="no src">',
    '<img src="https://cdn.example.com/a.png" srcset="https://cdn.example.com/a.png 0x">',
    '<img src="">',
  ])('rejects broken media: %s', (html) => {
    expect(hasBrokenMediaTag(html)).toBe(true);
  });
});
