import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Feed } from 'feed';
import { describe, expect, it } from 'vitest';
import { sanitizeForFeed } from './sanitize';
import { stripInvalidXml10Characters } from './sanitize-xml-10';

describe('RSS XML character safety', () => {
  it('removes XML 1.0 forbidden controls while retaining valid Unicode text', () => {
    expect(stripInvalidXml10Characters('₦\u001a61,817,004.65\t📱')).toBe(
      '₦61,817,004.65\t📱'
    );
  });

  it('removes XML-forbidden characters without dropping valid supplementary characters', () => {
    expect(
      stripInvalidXml10Characters(
        'title\u0000\u0008\u000b\u000c\u001a\ufffe\uffff📱'
      )
    ).toBe('title📱');
  });

  it.each([null, undefined])('returns an empty string for %s', (value) => {
    expect(stripInvalidXml10Characters(value)).toBe('');
  });

  it('produces RSS that parses as XML when inputs contain control characters', () => {
    const feed = new Feed({
      title: stripInvalidXml10Characters('Oga\u001aBassey Blog'),
      description: stripInvalidXml10Characters('Phones\u000b and laptops'),
      id: 'https://usebaci.com/blog',
      link: 'https://usebaci.com/blog',
      copyright: 'All rights reserved',
    });
    feed.addItem({
      title: stripInvalidXml10Characters('Phone\u001a guide'),
      id: 'https://usebaci.com/blog/phone-guide',
      link: 'https://usebaci.com/blog/phone-guide',
      description: stripInvalidXml10Characters('Price\u000b update'),
      content: sanitizeForFeed('<p>₦61,817,004.65\u001a📱</p>'),
      author: [
        {
          name: stripInvalidXml10Characters('Author\u0000 Name'),
          link: 'https://usebaci.com',
        },
      ],
      date: new Date('2026-05-02T10:00:00.000Z'),
    });

    const xml = feed.rss2();
    expect(XMLValidator.validate(xml)).toBe(true);

    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
      rss?: { channel?: { title?: string; item?: unknown } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems]) as Array<{
      title?: string;
      author?: string;
    }>;

    expect(parsed.rss?.channel?.title).toBe('OgaBassey Blog');
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Phone guide');
    expect(items[0]?.author).toBe('Author Name');
  });
});
