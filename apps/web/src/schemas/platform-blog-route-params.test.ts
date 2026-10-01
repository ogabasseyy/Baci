import { describe, expect, it } from 'vitest';
import { platformBlogRouteParamsSchema } from './platform-blog-route-params';

describe('platformBlogRouteParamsSchema', () => {
  it('accepts a non-empty post identifier', () => {
    expect(
      platformBlogRouteParamsSchema.safeParse({ id: 'post-1' }).success
    ).toBe(true);
  });

  it('rejects empty or missing post identifiers', () => {
    expect(platformBlogRouteParamsSchema.safeParse({ id: '' }).success).toBe(
      false
    );
    expect(platformBlogRouteParamsSchema.safeParse({}).success).toBe(false);
  });
});
