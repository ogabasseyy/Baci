import { describe, expect, it } from 'vitest';
import {
  escapeHtmlAttr,
  readHtmlTagAttribute,
  setHtmlAttribute,
  stripHtmlAttribute,
} from './blog-html-attribute-utils';

describe('blog HTML attribute utilities', () => {
  it('escapes values for safe attribute insertion', () => {
    expect(escapeHtmlAttr(`A "quote" & <tag>`)).toBe(
      'A &quot;quote&quot; &amp; &lt;tag&gt;'
    );
  });

  it('reads quoted attributes without splitting on greater-than signs', () => {
    expect(
      readHtmlTagAttribute(
        '<img alt="value a > b" src="https://cdn.example.com/a.png" />',
        'src'
      )
    ).toBe('https://cdn.example.com/a.png');
  });

  it('replaces a target attribute without mutating similar quoted text', () => {
    const tag = '<img alt="notes src=text" src="old.png" />';

    expect(setHtmlAttribute(tag, 'src', 'new.png')).toBe(
      '<img alt="notes src=text" src="new.png" />'
    );
    expect(stripHtmlAttribute(tag, 'src')).toBe('<img alt="notes src=text" />');
  });

  it('handles malformed self-closing separators without hanging', () => {
    expect(readHtmlTagAttribute('<img src="a.jpg" / >', 'title')).toBeNull();
    expect(readHtmlTagAttribute('<img src="a.jpg" / >', 'src')).toBe('a.jpg');
  });
});
