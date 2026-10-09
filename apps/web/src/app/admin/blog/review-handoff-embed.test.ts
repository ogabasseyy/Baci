import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasUnpreservableEmbed } from './review-handoff-embed';

describe('hasUnpreservableEmbed', () => {
  it.each([
    '<iframe src="https://www.youtube.com/embed/abc"></iframe><p>Body</p>',
    '<iframe width="560" height="315" src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>',
    '<IFRAME SRC="https://player.vimeo.com/video/1"></IFRAME>',
    '<object data="https://cdn.example.com/a.swf"></object>',
    '<embed src="https://cdn.example.com/a.pdf">',
    '<video src="https://cdn.example.com/a.mp4"></video>',
    '<audio src="https://cdn.example.com/a.mp3"></audio>',
  ])('flags unpreservable embeds: %s', (html) => {
    expect(hasUnpreservableEmbed(html)).toBe(true);
  });

  it.each([
    '<p>Visible article</p>',
    '<img src="https://cdn.example.com/a.png">',
    '<!-- <iframe src="https://www.youtube.com/embed/abc"></iframe> --><p>Body</p>',
    '<p>An iframe-shaped <!-- <video> --> word</p>',
    '</iframe>',
  ])('ignores non-embed markup: %s', (html) => {
    expect(hasUnpreservableEmbed(html)).toBe(false);
  });

  it('rejects a YouTube embed beside body text at import', () => {
    expect(() =>
      validateImportedContent(
        '<iframe src="https://www.youtube.com/embed/abc"></iframe><p>Body</p>'
      )
    ).toThrow('embed markup the editor cannot preserve');
  });
});
