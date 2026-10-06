import { expect, it } from 'vitest';
import { sanitizeBlogPostData } from '@/lib/validations/blog';
import { toApiPayload } from './blog-api-payload';
import { parseReviewHandoff } from './parse-review-handoff';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'Article',
  content_html: '<p>Article body</p>',
  featured_image: { url: 'https://cdn.example.com/cover.webp' },
};

it.each([
  '{"foo":"bar"}',
  '{"type":"doc","content":{}}',
  '{"type":"doc","content":[]}',
  '[{"type":"paragraph"}]',
  '  {"foo":"bar"} <p>Body</p>',
  '<script>bad()</script>{"foo":"bar"}',
])('rejects content that could enter the structured-content path: %s', (content_html) => {
  expect(() => parseReviewHandoff({ ...handoff, content_html })).toThrow(
    'HTML'
  );
});

it('accepts JSON examples inside HTML paragraphs', () => {
  expect(
    parseReviewHandoff({ ...handoff, content_html: '<p>{"foo":"bar"}</p>' })
      .content
  ).toBe('<p>{"foo":"bar"}</p>');
});

it.each([
  'Research, Development',
  'One,Two',
])('rejects a tag that would be split on save: %s', (tag) => {
  expect(() =>
    parseReviewHandoff({ ...handoff, tags: ['Valid', tag] })
  ).toThrow('commas');
});

it.each([
  ['Valid', 123],
  'Valid, Other',
  42,
])('rejects wrong-typed tags: %j', (tags) => {
  expect(() => parseReviewHandoff({ ...handoff, tags })).toThrow(
    'array of strings'
  );
});

it('accepts missing or null tags', () => {
  expect(parseReviewHandoff({ ...handoff, tags: null }).tags).toBe('');
  expect(parseReviewHandoff(handoff).tags).toBe('');
});

it('rejects tags containing null bytes', () => {
  const nul = String.fromCharCode(0);
  expect(() =>
    parseReviewHandoff({ ...handoff, tags: ['Valid', `Bro${nul}ken`] })
  ).toThrow('null bytes');
});

it.each([
  '[Read the guide](https://example.com)',
  '[Breaking] news today',
])('accepts bracket-led prose that is not JSON: %s', (content_html) => {
  expect(() => parseReviewHandoff({ ...handoff, content_html })).not.toThrow();
});

it.each([
  '{Note}: review this section',
  '{TODO} fix the intro',
])('accepts brace-led prose that is not JSON: %s', (lead) => {
  expect(() =>
    parseReviewHandoff({ ...handoff, content_html: `${lead}\n\nBody text` })
  ).not.toThrow();
});

it('preserves a leading indented code block', () => {
  expect(
    parseReviewHandoff({
      ...handoff,
      content_html: '    const x = 1;\n\nBody text here',
    }).content
  ).toContain('<code>');
});

it.each([
  '[1, 2]',
  '[]',
])('rejects content that parses as a JSON array: %s', (content_html) => {
  expect(() => parseReviewHandoff({ ...handoff, content_html })).toThrow(
    'HTML'
  );
});

it('round-trips representable tag names through the save sanitizer', () => {
  const form = parseReviewHandoff({
    ...handoff,
    tags: [' Research & Development ', 'Nigeria'],
  });
  expect(sanitizeBlogPostData(toApiPayload(form)).tags).toEqual([
    'Research & Development',
    'Nigeria',
  ]);
});
