import { describe, expect, it } from 'vitest';
import { blogPostSchema, createPostSchema, sanitizeBlogPostData } from './blog';

const post = {
  title: 'Guide',
  slug: 'guide',
  content: '<p>Guide body</p>',
  author_name: 'Editorial',
};

describe.each([
  ['create', createPostSchema],
  ['update', blogPostSchema],
] as const)('%s intent metadata', (_, schema) => {
  it.each([null, '', '   '])('accepts unset metadata: %j', (value) => {
    const result = schema.parse(
      sanitizeBlogPostData({
        ...post,
        intent: value,
        intent_source: value,
        focus_keyword: value,
      })
    );
    expect(result).toMatchObject({
      intent: null,
      intent_source: null,
      focus_keyword: null,
    });
  });
  it('preserves omission rather than inventing intent', () => {
    const result = schema.parse(post);
    expect(result).not.toHaveProperty('intent');
    expect(result).not.toHaveProperty('intent_source');
  });
  it('still rejects unsupported intent and overlong metadata', () => {
    for (const metadata of [
      { intent: 'invalid' },
      { intent_source: 'x'.repeat(101) },
      { focus_keyword: 'x'.repeat(51) },
    ]) {
      expect(schema.safeParse({ ...post, ...metadata }).success).toBe(false);
    }
  });
});
