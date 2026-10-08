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
});
