import { describe, expect, it } from 'vitest';
import {
  BOILERPLATE_BLOG_METADATA_PHRASES,
  extractBlogPostBrandFamilies,
  scoreBlogPostBrandAffinity,
} from './blog-post-brand-affinity';

describe('blog-post-brand-affinity', () => {
  it('maps brand and model-line tokens to canonical brand families', () => {
    expect(extractBlogPostBrandFamilies(['camon', 'tecno', '5g'])).toEqual([
      'tecno',
    ]);
    expect(extractBlogPostBrandFamilies(['iphone', 'galaxy'])).toEqual([
      'apple',
      'samsung',
    ]);
  });

  it('ignores inherited prototype properties when resolving tokens', () => {
    expect(extractBlogPostBrandFamilies(['constructor', 'toString'])).toEqual(
      []
    );
  });

  it('rewards shared brand families and penalizes disjoint single-brand matches', () => {
    expect(scoreBlogPostBrandAffinity(['tecno', 'camon'], ['spark'])).toBe(20);
    expect(scoreBlogPostBrandAffinity(['tecno', 'camon'], ['iphone'])).toBe(-8);
    expect(scoreBlogPostBrandAffinity(['budget', 'phone'], ['iphone'])).toBe(0);
  });

  it('includes generic category and Nigeria buyer guide phrases in boilerplate set', () => {
    expect(BOILERPLATE_BLOG_METADATA_PHRASES.has('smartphones')).toBe(true);
    expect(BOILERPLATE_BLOG_METADATA_PHRASES.has('nigeria buyer guide')).toBe(
      true
    );
  });
});
