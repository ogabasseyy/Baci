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

describe('sanitizeBlogPostData intent pair-consistency', () => {
  it.each([
    null,
    '',
    '   ',
    undefined,
  ])('clears an orphan source for explicitly nullish intent: %j', (intent) => {
    expect(
      sanitizeBlogPostData({ intent, intent_source: 'draft_task_type' })
    ).toMatchObject({ intent_source: null });
  });

  it('injects a null source clear when only the intent is nulled', () => {
    expect(sanitizeBlogPostData({ intent: null })).toMatchObject({
      intent: null,
      intent_source: null,
    });
  });

  it('preserves a classified intent pair', () => {
    expect(
      sanitizeBlogPostData({ intent: 'news', intent_source: 'draft_task_type' })
    ).toMatchObject({ intent: 'news', intent_source: 'draft_task_type' });
  });

  it('leaves a source-only payload untouched for PATCH merge semantics', () => {
    // No intent key means "leave the stored pair alone" — the PATCH handler
    // merges supplied fields onto the existing row.
    expect(
      sanitizeBlogPostData({ intent_source: 'draft_task_type' })
    ).toMatchObject({ intent_source: 'draft_task_type' });
  });
});
