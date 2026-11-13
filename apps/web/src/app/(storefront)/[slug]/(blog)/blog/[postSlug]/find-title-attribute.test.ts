import { describe, expect, it } from 'vitest';
import { findTitleAttribute } from './find-title-attribute';

describe('findTitleAttribute', () => {
  it('extracts double-quoted and single-quoted title attributes', () => {
    const doubleQuoted = '<img src="a.jpg" title="Hero shot" alt="Hero">';
    const dqMatch = findTitleAttribute(doubleQuoted);
    expect(dqMatch).not.toBeNull();
    expect(dqMatch?.value).toBe('Hero shot');
    expect(
      doubleQuoted.slice(0, dqMatch?.start) + doubleQuoted.slice(dqMatch?.end)
    ).toBe('<img src="a.jpg" alt="Hero">');

    const singleQuoted = "<img src='a.jpg' title='Hero shot' alt='Hero'>";
    expect(findTitleAttribute(singleQuoted)?.value).toBe('Hero shot');
  });

  it('extracts title attributes when tag uses newline or tab after <img', () => {
    const newlineImg = '<img\ntitle="Photo caption"\n  src="image.jpg">';
    expect(findTitleAttribute(newlineImg)?.value).toBe('Photo caption');

    const tabImg = '<img\ttitle="Tab caption" src="image.jpg">';
    expect(findTitleAttribute(tabImg)?.value).toBe('Tab caption');
  });

  it('extracts unquoted title attribute values', () => {
    expect(findTitleAttribute('<img title=Caption src="a.jpg">')?.value).toBe(
      'Caption'
    );
    expect(findTitleAttribute('<img src="a.jpg" title=Caption/>')?.value).toBe(
      'Caption'
    );
  });

  it('ignores title substrings inside other attributes like alt', () => {
    expect(
      findTitleAttribute('<img src="a.jpg" alt="title=\'fake\'">')
    ).toBeNull();
  });

  it('returns null when img tag has no whitespace or no title attribute', () => {
    expect(findTitleAttribute('<img>')).toBeNull();
    expect(findTitleAttribute('<img src="a.jpg" alt="Photo">')).toBeNull();
  });
});
