import { describe, expect, it } from 'vitest';
import { generateMetaTitle } from './generate-meta-title';

describe('generateMetaTitle', () => {
  it('removes duplicated suffixes and keeps a single merchant suffix', () => {
    expect(
      generateMetaTitle('Buy Smartphones in Nigeria | Ogabassey | Ogabassey', {
        suffix: 'Ogabassey',
        maxLength: 70,
      })
    ).toBe('Buy Smartphones in Nigeria | Ogabassey');
  });

  it('truncates long titles at a clean word boundary instead of mid-word', () => {
    const title = generateMetaTitle(
      'Apple MacBook Pro 16-inch M3 Max Price in Nigeria',
      {
        suffix: 'Ogabassey',
        maxLength: 60,
      }
    );

    expect(title).toBe(
      'Apple MacBook Pro 16-inch M3 Max Price in... | Ogabassey'
    );
    expect(title).not.toContain('Nig...');
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('truncates titles without a suffix at a word boundary', () => {
    const title = generateMetaTitle(
      'Samsung Galaxy S24 Ultra Price in Nigeria and Full Specs Guide',
      { maxLength: 45 }
    );

    expect(title).toBe('Samsung Galaxy S24 Ultra Price in Nigeria...');
    expect(title.length).toBeLessThanOrEqual(45);
  });

  it('falls back to a raw character slice when a single unbroken token exceeds maxLength', () => {
    const title = generateMetaTitle(
      'SupercalifragilisticexpialidociousDevice',
      {
        maxLength: 20,
      }
    );

    expect(title).toBe('Supercalifragilis...');
    expect(title).toHaveLength(20);
  });

  it('returns fallback or empty string when title is blank', () => {
    expect(
      generateMetaTitle('   ', {
        fallback: 'Smartphones',
        suffix: 'Ogabassey',
      })
    ).toBe('Smartphones | Ogabassey');
    expect(generateMetaTitle('   ')).toBe('');
  });
});
