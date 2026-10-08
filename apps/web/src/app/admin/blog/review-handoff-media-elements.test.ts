import { describe, expect, it } from 'vitest';
import { matchMediaElements } from './review-handoff-media-elements';

describe('matchMediaElements', () => {
  it('matches img and source elements with their positions', () => {
    const html =
      '<p>Body</p><img src="https://cdn.example.com/a.png"><picture><source srcset="https://cdn.example.com/a.webp"></picture>';
    const matches = matchMediaElements(html);
    expect(matches.map((match) => match[0])).toEqual([
      '<img src="https://cdn.example.com/a.png">',
      '<picture>',
      '<source srcset="https://cdn.example.com/a.webp">',
      '</picture>',
    ]);
    expect(matches.map((match) => match.index)).toEqual([
      html.indexOf('<img'),
      html.indexOf('<picture>'),
      html.indexOf('<source'),
      html.indexOf('</picture>'),
    ]);
  });

  it('matches uppercase and self-closing media elements', () => {
    expect(
      matchMediaElements(
        '<IMG SRC="https://cdn.example.com/a.png" /><PICTURE><SOURCE SRCSET="https://cdn.example.com/a.webp" /></PICTURE>'
      ).map((match) => match[0])
    ).toEqual([
      '<IMG SRC="https://cdn.example.com/a.png" />',
      '<PICTURE>',
      '<SOURCE SRCSET="https://cdn.example.com/a.webp" />',
      '</PICTURE>',
    ]);
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
    ).toEqual([
      '<picture>',
      '<source srcset="https://cdn.example.com/a.webp">',
      '</picture>',
    ]);
  });

  it('skips sources nested below a non-picture element', () => {
    // Only direct picture children participate; a source wrapped in
    // a div is inert even inside a picture.
    expect(
      matchMediaElements(
        '<picture><div><source srcset="https://cdn.example.com/a.webp"></div><img alt=""></picture>'
      ).map((match) => match[0])
    ).toEqual(['<picture>', '<img alt="">', '</picture>']);
  });

  it('skips sources inside video elements', () => {
    expect(
      matchMediaElements(
        '<video><source src="https://cdn.example.com/a.mp4"></video>'
      )
    ).toEqual([]);
  });

  it('flags picture-bound img elements by direct ancestry', () => {
    // Only a direct picture child associates with the picture
    // sources; nested and standalone images stand alone.
    const matches = matchMediaElements(
      '<picture><div><img alt="nested"></div><img alt="direct"></picture><img alt="standalone">'
    );
    expect(matches.map((match) => match.directPictureChild)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('returns no matches for text without elements', () => {
    expect(matchMediaElements('a < b and c > d')).toEqual([]);
  });
});
