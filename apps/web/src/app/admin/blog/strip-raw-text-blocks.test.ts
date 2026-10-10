import { describe, expect, it } from 'vitest';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

describe('stripRawTextBlocks', () => {
  it.each([
    ['script', '<script>if (a < b) { x("<img>"); }</script>'],
    ['style', '<style>.a::before { content: "<img>"; }</style>'],
    ['textarea', '<textarea><img src="x"></textarea>'],
    ['title', '<title>a < b</title>'],
    ['xmp', '<xmp><p>raw</p></xmp>'],
    ['iframe', '<iframe src="x">fallback <b>text</b></iframe>'],
    ['noembed', '<noembed><embed></noembed>'],
    ['noframes', '<noframes><p>no</p></noframes>'],
    ['noscript', '<noscript><img src="x"></noscript>'],
  ])('removes a closed %s block', (_, block) => {
    expect(stripRawTextBlocks(`<p>Keep</p>${block}<p>Keep</p>`)).toBe(
      '<p>Keep</p><p>Keep</p>'
    );
  });

  it('removes an unclosed block through the end of input', () => {
    expect(stripRawTextBlocks('<p>Keep</p><script>swallowed <b>all')).toBe(
      '<p>Keep</p>'
    );
  });

  it('matches openers case-insensitively with attributes', () => {
    expect(
      stripRawTextBlocks('<SCRIPT type="text/javascript">x</SCRIPT><p>Keep</p>')
    ).toBe('<p>Keep</p>');
  });

  it('accepts whitespace before the closing bracket', () => {
    expect(stripRawTextBlocks('<style>a</style  ><p>Keep</p>')).toBe(
      '<p>Keep</p>'
    );
  });

  it('lets a proper closer win over later openers', () => {
    expect(
      stripRawTextBlocks('<script>a</script><script>b</script><p>Keep</p>')
    ).toBe('<p>Keep</p>');
  });

  it('leaves ordinary elements untouched', () => {
    const html = '<div><p>Keep <img src="x"></p></div>';
    expect(stripRawTextBlocks(html)).toBe(html);
  });

  it('leaves script-like text outside elements untouched', () => {
    expect(stripRawTextBlocks('a < b and c > d')).toBe('a < b and c > d');
  });
});
