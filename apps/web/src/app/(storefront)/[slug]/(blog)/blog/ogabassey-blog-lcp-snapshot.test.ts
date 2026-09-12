import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';

describe('ogabasseyBlogLcpSnapshot', () => {
  it('is a sync JSON snapshot so leaf loading can commit the parent PPR slot', () => {
    expect(ogabasseyBlogLcpSnapshot.featuredPost.slug).toBe(
      'hp-elitebook-x-flip-g1i-who-should-pay-for-the-32gb-flip-business-laptop-1788846889'
    );
    expect(ogabasseyBlogLcpSnapshot.imageSrc).toContain(
      'hp-elitebook-x-flip-g1i-who-should-pay-for-the-32gb-flip-busines'
    );
  });

  it('does not top-level-await the listing fetch', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'ogabassey-blog-lcp-snapshot.ts'
      ),
      'utf8'
    );

    expect(source).not.toMatch(/=\s*await\b/);
    expect(source).toContain("from './ogabassey-blog-lcp-snapshot.json'");
  });
});
