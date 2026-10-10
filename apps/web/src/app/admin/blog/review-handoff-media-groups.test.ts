import { describe, expect, it } from 'vitest';
import { groupMediaElements } from './review-handoff-media-groups';

const IMG = '<img src="https://cdn.example.com/a.png">';

describe('groupMediaElements', () => {
  it('groups pre-img applicable sources with their img', () => {
    expect(
      groupMediaElements(
        '<picture><source srcset="https://cdn.example.com/a.webp"><source type="image/webp" srcset="https://cdn.example.com/b.webp">IMG</picture>'.replace(
          'IMG',
          IMG
        )
      )
    ).toEqual([
      {
        tags: [
          '<source srcset="https://cdn.example.com/a.webp">',
          '<source type="image/webp" srcset="https://cdn.example.com/b.webp">',
          IMG,
        ],
        hasMedia: true,
      },
    ]);
  });

  it('drops sources after the img', () => {
    expect(
      groupMediaElements(
        `<picture>${IMG}<source srcset="https://cdn.example.com/a.webp"></picture>`
      )
    ).toEqual([{ tags: [IMG], hasMedia: true }]);
  });

  it('drops sources with inapplicable types', () => {
    expect(
      groupMediaElements(
        `<picture><source type="image/tiff" srcset="https://cdn.example.com/a.tiff">${IMG}</picture>`
      )
    ).toEqual([{ tags: [IMG], hasMedia: true }]);
  });

  it('drops sources with never-matching media', () => {
    expect(
      groupMediaElements(
        `<picture><source media="not all" srcset="https://cdn.example.com/a.webp">${IMG}</picture>`
      )
    ).toEqual([{ tags: [IMG], hasMedia: true }]);
  });

  it('keeps sources with applicable media and typed codecs', () => {
    // Any other media value is assumed applicable, and type parameters
    // compare by essence.
    expect(
      groupMediaElements(
        '<picture><source media="(min-width: 800px)" type="image/webp; codecs=vp9" srcset="https://cdn.example.com/a.webp">IMG</picture>'.replace(
          'IMG',
          IMG
        )
      )
    ).toEqual([
      {
        tags: [
          '<source media="(min-width: 800px)" type="image/webp; codecs=vp9" srcset="https://cdn.example.com/a.webp">',
          IMG,
        ],
        hasMedia: true,
      },
    ]);
  });

  it('treats APNG sources as applicable', () => {
    expect(
      groupMediaElements(
        `<picture><source type="image/apng" srcset="https://cdn.example.com/a.apng">${IMG}</picture>`
      )
    ).toEqual([
      {
        tags: [
          '<source type="image/apng" srcset="https://cdn.example.com/a.apng">',
          IMG,
        ],
        hasMedia: true,
      },
    ]);
  });

  it('forms singleton groups for standalone images', () => {
    expect(groupMediaElements(`<p>Body</p>${IMG}`)).toEqual([
      { tags: [IMG], hasMedia: true },
    ]);
  });

  it('stands a nested picture img alone', () => {
    // An img wrapped in another element inside a picture is not
    // associated with the picture sources.
    expect(
      groupMediaElements(
        `<picture><source srcset="https://cdn.example.com/a.webp"><div>${IMG}</div></picture>`
      )
    ).toEqual([
      {
        tags: ['<source srcset="https://cdn.example.com/a.webp">'],
        hasMedia: true,
      },
      { tags: [IMG], hasMedia: true },
    ]);
  });

  it('ignores media hidden in comments and raw-text blocks', () => {
    expect(
      groupMediaElements(`<!-- ${IMG} --><script>const s = "${IMG}";</script>`)
    ).toEqual([]);
  });

  it('marks pictures without media elements inert', () => {
    expect(groupMediaElements('<picture></picture>')).toEqual([
      { tags: [], hasMedia: false },
    ]);
  });

  it('marks pictures with only inapplicable sources inert', () => {
    expect(
      groupMediaElements(
        '<picture><source type="image/tiff" srcset="https://cdn.example.com/a.tiff"></picture>'
      )
    ).toEqual([{ tags: [], hasMedia: false }]);
  });

  it('normalizes tag case and self-closing slashes', () => {
    expect(
      groupMediaElements(
        '<PICTURE><SOURCE SRCSET="https://cdn.example.com/a.webp" /><IMG SRC="https://cdn.example.com/a.png" /></PICTURE>'
      )
    ).toEqual([
      {
        tags: [
          '<source srcset="https://cdn.example.com/a.webp">',
          '<img src="https://cdn.example.com/a.png">',
        ],
        hasMedia: true,
      },
    ]);
  });

  it('ignores media-like text inside attribute values', () => {
    expect(
      groupMediaElements(
        `<div title="<img src='http://example.com/draft.png'>">Readable</div>`
      )
    ).toEqual([]);
  });

  it('ignores stray closes and video sources', () => {
    // A `</div>` with no open div must not pop the picture the
    // following img belongs to; video sources are never candidates.
    expect(
      groupMediaElements(
        '<picture><source srcset="https://cdn.example.com/a.webp"></div><img alt=""></picture><video><source src="https://cdn.example.com/a.mp4"></video>'
      )
    ).toEqual([
      {
        tags: [
          '<source srcset="https://cdn.example.com/a.webp">',
          '<img alt="">',
        ],
        hasMedia: true,
      },
    ]);
  });

  it('skips sources nested below a non-picture element', () => {
    expect(
      groupMediaElements(
        '<picture><div><source srcset="https://cdn.example.com/a.webp"></div><img alt=""></picture>'
      )
    ).toEqual([{ tags: ['<img alt="">'], hasMedia: true }]);
  });

  it('finds trailing media after deep nesting', () => {
    // The native parser handles pathological nesting; only the
    // grouping verdict matters, not jsdom's parse speed.
    const html = `${'<div>'.repeat(800)}${'</span>'.repeat(800)}<img src="https://cdn.example.com/a.webp">`;
    expect(groupMediaElements(html)).toEqual([
      {
        tags: ['<img src="https://cdn.example.com/a.webp">'],
        hasMedia: true,
      },
    ]);
  });
});
