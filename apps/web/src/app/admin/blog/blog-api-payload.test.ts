import { expect, it, vi } from 'vitest';
import { updatePlatformBlogPost } from './blog-api';
import { toApiPayload } from './blog-api-payload';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogPostDetail,
} from './blog-types';
import { parseReviewHandoff } from './parse-review-handoff';

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

const storedPost: PlatformAdminBlogPostDetail = {
  author_name: 'Baci Editorial',
  category: null,
  content: 'Hello world',
  excerpt: null,
  featured_image_alt: 'The old cover',
  featured_image_height: 675,
  featured_image_url: 'https://cdn.example.com/platform/blog/old.webp',
  featured_image_variants: {
    landscape_16x9: 'https://cdn.example.com/platform/blog/old-16x9.webp',
  },
  featured_image_width: 1200,
  id: 'post-1',
  published_at: null,
  seo_description: null,
  seo_title: null,
  slug: 'launch-faster',
  status: 'draft',
  tags: [],
  title: 'Launch Faster',
};

it('drops unedited alt text when the cover URL changes without new metadata', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: 'The old cover',
    featured_image_height: storedPost.featured_image_height,
    featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
    featured_image_variants: { ...storedPost.featured_image_variants },
    featured_image_width: storedPost.featured_image_width,
  };
  expect(
    toApiPayload(form, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBeNull();
});

it('drops unedited alt text when the cover URL and metadata change together', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: 'The old cover',
    featured_image_height: 900,
    featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
    featured_image_width: 1600,
  };
  expect(
    toApiPayload(form, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBeNull();
});

it('keeps hand-edited alt text for a changed cover URL', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: 'The new cover',
    featured_image_alt_edited: true,
    featured_image_height: storedPost.featured_image_height,
    featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
    featured_image_variants: { ...storedPost.featured_image_variants },
    featured_image_width: storedPost.featured_image_width,
  };
  expect(
    toApiPayload(form, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBe('The new cover');
});

it('keeps imported alt text for a replacement cover during edit-import', () => {
  // End-to-end edit-import: parse a handoff carrying a new cover plus
  // its description, then reconcile against the stored post. The
  // import marks its alt fresh, so the payload keeps the description
  // for the new cover instead of nulling it as stale.
  const imported = parseReviewHandoff({
    category: 'Smartphones',
    content_html: '<p>Choose a Galaxy A phone.</p>',
    excerpt: 'A practical guide.',
    featured_image: {
      alt: 'The imported cover',
      height: 675,
      url: 'https://cdn.example.com/platform/blog/new.webp',
      variants: {},
      width: 1200,
    },
    focus_keyword: 'Galaxy A buyer guide',
    intent: 'buying-guide',
    intent_source: 'draft_task_type',
    schema_version: 'baci-blog-review-handoff/v1',
    seo_description: 'Compare current Galaxy A options.',
    seo_title: 'Galaxy A buyer guide',
    status: 'published',
    tags: ['Samsung'],
    title: 'Galaxy A buyer guide',
  });
  expect(imported.featured_image_alt_edited).toBe(true);
  expect(
    toApiPayload(imported, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBe('The imported cover');
});

it('clears alt text the reviewer deliberately emptied', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: '',
    featured_image_alt_edited: true,
    featured_image_url: storedPost.featured_image_url ?? '',
  };
  expect(
    toApiPayload(form, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBeNull();
});

it('clears hand-edited alt text when the image URL is removed on PATCH', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: 'Typed after removal',
    featured_image_alt_edited: true,
    featured_image_url: '',
  };
  expect(
    toApiPayload(form, { clearEmptyToNull: true, existingPost: storedPost })
      .featured_image_alt
  ).toBeNull();
});

it('omits alt text without an image URL on create', () => {
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    featured_image_alt: 'No image to describe',
    featured_image_alt_edited: true,
  };
  expect(toApiPayload(form).featured_image_alt).toBeUndefined();
});

it('nulls an orphan intent_source when intent is cleared on PATCH', async () => {
  fetchWithCsrf.mockClear();
  const form = {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    intent: null,
    intent_source: 'draft_task_type',
  };
  expect(JSON.parse(JSON.stringify(toApiPayload(form)))).not.toHaveProperty(
    'intent_source'
  );
  fetchWithCsrf.mockResolvedValue(
    new Response(JSON.stringify({ post: { id: 'post-1' } }), { status: 200 })
  );
  await updatePlatformBlogPost('post-1', form);
  expect(JSON.parse(fetchWithCsrf.mock.calls[0][1].body)).toMatchObject({
    intent: null,
    intent_source: null,
  });
});
