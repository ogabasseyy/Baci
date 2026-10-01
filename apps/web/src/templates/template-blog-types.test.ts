import { describe, expect, it } from 'vitest';
import type { TemplateBlogPageProps } from './template-blog-types';

describe('TemplateBlogPageProps', () => {
  it('allows hiding the featured story when a parent committed the listing LCP', () => {
    const props: TemplateBlogPageProps = {
      hideFeaturedStory: true,
      searchQuery: 'iphone',
    };

    expect(props.hideFeaturedStory).toBe(true);
    expect(props.searchQuery).toBe('iphone');
  });
});
