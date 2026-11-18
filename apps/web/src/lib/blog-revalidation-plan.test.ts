import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { buildBlogRevalidationPlan } from './blog-revalidation-plan';

describe('buildBlogRevalidationPlan', () => {
  it('emits only tenant and identifier scoped tags when merchantId and identifiers are supplied', () => {
    const plan = buildBlogRevalidationPlan({
      merchantId: 'merchant-1',
      identifiers: ['Ogabassey', 'ogabassey.com'],
      canonicalMerchantSlug: 'ogabassey',
      listingCategories: ['Buying Guides'],
      listingPages: [1, 2],
      postSlugs: ['Best-Phone'],
    });

    expect(plan.tags).not.toContain('blog-posts');
    expect(plan.tags).not.toContain('blog-rss-feed');
    expect(plan.tags).not.toContain('blog-content-links');
    expect(plan.tags).toEqual(
      expect.arrayContaining([
        'blog-posts-merchant-1',
        'blog-categories-merchant-1',
        getBlogContentLinksCacheTag('merchant-1'),
        'blog-rss-id-merchant-1',
        'blog-rss-slug-ogabassey',
        'blog-rss-slug-ogabassey.com',
        'blog-identifier-ogabassey',
        'blog-identifier-ogabassey.com',
        'blog-listing-status-ogabassey',
        'blog-category-hub-ogabassey',
        'blog-list-ogabassey-all-1',
        'blog-list-ogabassey-Buying Guides-2',
        getBlogCacheTag('ogabassey', 'best-phone'),
        getBlogCacheTag('ogabassey.com', 'best-phone'),
      ])
    );
    expect(plan.paths).toContain('/api/blog/feed/ogabassey');
    expect(plan.purgeCategorySlugs).toEqual(['buying-guides']);
  });

  it('supports merchantId-only revalidation without global blog tags', () => {
    const plan = buildBlogRevalidationPlan({ merchantId: 'merchant-1' });

    expect(plan.tags).toEqual([
      'blog-posts-merchant-1',
      'blog-categories-merchant-1',
      getBlogContentLinksCacheTag('merchant-1'),
      'blog-rss-id-merchant-1',
    ]);
    expect(plan.paths).toEqual([]);
  });

  it('namespaces merchant-id RSS tags separately from slug tags and lowercases merchantId', () => {
    const plan = buildBlogRevalidationPlan({
      merchantId: 'Ogabassey',
      identifiers: ['other-store'],
    });

    expect(plan.tags).toContain('blog-posts-ogabassey');
    expect(plan.tags).toContain('blog-categories-ogabassey');
    expect(plan.tags).toContain('blog-rss-id-ogabassey');
    expect(plan.tags).not.toContain('blog-rss-slug-ogabassey');
  });

  it('retains global fallback tags when identifiers are supplied without merchantId', () => {
    const plan = buildBlogRevalidationPlan('Ogabassey', 'Best-Phone');

    expect(plan.tags).toEqual(
      expect.arrayContaining([
        'blog-posts',
        'blog-rss-feed',
        'blog-content-links',
        'blog-identifier-ogabassey',
        'blog-rss-slug-ogabassey',
        'blog-list-ogabassey-all-1',
        getBlogCacheTag('ogabassey', 'best-phone'),
      ])
    );
  });

  it('retains global fallback tags when an invalid canonical slug is supplied without merchantId', () => {
    const plan = buildBlogRevalidationPlan({
      canonicalMerchantSlug: '../evil',
    });

    expect(plan.invalidCanonicalMerchantSlug).toBe('../evil');
    expect(plan.tags).toEqual([
      'blog-rss-feed',
      'blog-posts',
      'blog-content-links',
    ]);
  });

  it('treats empty options as a no-op without busting global tags', () => {
    const plan = buildBlogRevalidationPlan({});

    expect(plan.tags).toEqual([]);
    expect(plan.paths).toEqual([]);
  });

  it('returns an empty plan when explicit identifiers normalize to empty', () => {
    const plan = buildBlogRevalidationPlan({
      identifiers: [' ', null, undefined],
      postSlugs: ['', null],
    });

    expect(plan.tags).toEqual([]);
    expect(plan.paths).toEqual([]);
  });

  it('guards against merchantId-only production callers of revalidateBlogPosts', () => {
    const srcRoot = join(process.cwd(), 'src');
    const sourceFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !/\.(test|spec|test-support)\.(ts|tsx)$/.test(entry.name) &&
          entry.name !== 'cache-revalidation.ts'
        ) {
          sourceFiles.push(fullPath);
        }
      }
    }

    walk(srcRoot);

    const callers: string[] = [];
    for (const filePath of sourceFiles) {
      const rawContent = readFileSync(filePath, 'utf8');
      if (!rawContent.includes('revalidateBlogPosts(')) {
        continue;
      }

      // Strip line and block comments so JSDoc examples do not match.
      const code = rawContent
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');

      const pattern = /\brevalidateBlogPosts\s*\(/g;
      for (const match of code.matchAll(pattern)) {
        let index = (match.index ?? 0) + match[0].length;
        let depth = 1;
        while (index < code.length && depth > 0) {
          const ch = code[index];
          if (ch === '(') depth += 1;
          else if (ch === ')') depth -= 1;
          index += 1;
        }
        const argsBody = code
          .slice((match.index ?? 0) + match[0].length, index - 1)
          .trim();
        const relPath = relative(srcRoot, filePath);

        expect(
          argsBody.startsWith('{'),
          `${relPath} must pass an options object to revalidateBlogPosts`
        ).toBe(true);
        expect(
          /\bidentifiers(?:\s*:|\s*[,}])/.test(argsBody),
          `${relPath} must pass identifiers to revalidateBlogPosts`
        ).toBe(true);
        expect(
          /\bcanonicalMerchantSlug(?:\s*:|\s*[,}])/.test(argsBody),
          `${relPath} must pass canonicalMerchantSlug to revalidateBlogPosts`
        ).toBe(true);
        callers.push(relPath);
      }
    }

    expect(callers.length).toBeGreaterThanOrEqual(7);
  });
});
