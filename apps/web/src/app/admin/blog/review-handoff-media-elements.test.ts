import { describe, expect, it } from 'vitest';
import { matchMediaElements } from './review-handoff-media-elements';

describe('matchMediaElements', () => {
  it('matches img and source elements with their positions', () => {
    const html =
      '<p>Body</p><img src="https://cdn.example.com/a.png"><picture><source srcset="https://cdn.example.com/a.webp"></picture>';
    const matches = matchMediaElements(html);
    expect(matches.map((match) => match[0])).toEqual([
      '<img src="https://cdn.example.com/a.png">',
      '<source srcset="https://cdn.example.com/a.webp">',
    ]);
    expect(matches.map((match) => match.index)).toEqual([
      html.indexOf('<img'),
      html.indexOf('<source'),
    ]);
  });

  it('matches uppercase and self-closing media elements', () => {
    expect(
      matchMediaElements(
        '<IMG SRC="https://cdn.example.com/a.png" /><PICTURE><SOURCE SRCSET="https://cdn.example.com/a.webp" /></PICTURE>'
      ).map((match) => match[0])
    ).toHaveLength(2);
  });

  it('consumes quoted angle brackets inside media attributes', () => {
    const matches = matchMediaElements(
      '<img alt="a>b" src="https://cdn.example.com/a.png">'
    );
    expect(matches.map((match) => match[0])).toEqual([
      '<img alt="a>b" src="https://cdn.example.com/a.png">',
    ]);
  });

  it('skips media-like text inside another element quoted attribute', () => {
    expect(
      matchMediaElements(
        `<div title="<img src='http://example.com/draft.png'>">Readable</div>`
      )
    ).toEqual([]);
  });

  it('skips non-media elements', () => {
    expect(
      matchMediaElements('<div><a href="https://x.test">x</a><br></div>')
    ).toEqual([]);
  });

  it('skips orphan sources outside any picture', () => {
    expect(
      matchMediaElements(
        '<source srcset="https://cdn.example.com/a.webp"><p>Body</p>'
      )
    ).toEqual([]);
  });

  it('skips sources after their picture closes', () => {
    expect(
      matchMediaElements(
        '<picture><source srcset="https://cdn.example.com/a.webp"></picture><source srcset="https://cdn.example.com/b.webp">'
      ).map((match) => match[0])
    ).toEqual(['<source srcset="https://cdn.example.com/a.webp">']);
  });

  it('skips sources inside video elements', () => {
    expect(
      matchMediaElements(
        '<video><source src="https://cdn.example.com/a.mp4"></video>'
      )
    ).toEqual([]);
  });

  it('returns no matches for text without elements', () => {
    expect(matchMediaElements('a < b and c > d')).toEqual([]);
  });
});
