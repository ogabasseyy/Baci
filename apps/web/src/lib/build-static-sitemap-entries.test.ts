import { describe, expect, it } from 'vitest';
import { buildStaticSitemapEntries } from './build-static-sitemap-entries';

describe('buildStaticSitemapEntries', () => {
  it('maps static sitemap pages onto the given site origin', () => {
    const entries = buildStaticSitemapEntries('https://usebaci.com');

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toEqual({
      url: 'https://usebaci.com/',
      changeFrequency: 'weekly',
      priority: 1.0,
    });
    expect(entries.map((entry) => entry.url)).toContain(
      'https://usebaci.com/pricing'
    );
  });
});
