import { expect, it, vi } from 'vitest';
import { updatePlatformBlogPost } from './blog-api';
import { toApiPayload } from './blog-api-payload';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';

const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

it.each([
  false,
  true,
])('normalizes slugs without sending a null clear value: PATCH=%s', (clearEmptyToNull) => {
  for (const [slug, expected] of [
    ['  guide  ', 'guide'],
    ['   ', undefined],
    ['', undefined],
  ]) {
    expect(
      toApiPayload(
        { ...DEFAULT_PLATFORM_BLOG_FORM_STATE, slug: slug ?? '' },
        { clearEmptyToNull }
      ).slug
    ).toBe(expected);
  }
});

it.each([
  '',
  null,
])('omits %s metadata on create and clears it explicitly on PATCH', async (empty) => {
  fetchWithCsrf.mockClear();
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    focus_keyword: empty,
    intent: null,
    intent_source: empty,
  };
  expect(JSON.parse(JSON.stringify(toApiPayload(form)))).not.toHaveProperty(
    'intent'
  );
  expect(JSON.parse(JSON.stringify(toApiPayload(form)))).not.toHaveProperty(
    'focus_keyword'
  );
  expect(JSON.parse(JSON.stringify(toApiPayload(form)))).not.toHaveProperty(
    'intent_source'
  );
  fetchWithCsrf.mockResolvedValue(
    new Response(JSON.stringify({ post: { id: 'post-1' } }), { status: 200 })
  );
  await updatePlatformBlogPost('post-1', form);
  expect(JSON.parse(fetchWithCsrf.mock.calls[0][1].body)).toMatchObject({
    focus_keyword: null,
    intent: null,
    intent_source: null,
  });
});
