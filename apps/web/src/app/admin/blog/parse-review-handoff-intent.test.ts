import { describe, expect, it } from 'vitest';
import { toApiPayload } from './blog-api-payload';
import { parseReviewHandoff } from './parse-review-handoff';

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'A practical guide',
  content_html: '<p>Choose the right product.</p>',
  featured_image: { url: 'https://cdn.example.com/guide.webp' },
};

describe('handoff intent provenance', () => {
  it.each([
    {},
    { intent: null, intent_source: null },
    { intent: '', intent_source: '' },
    { intent: '  ', intent_source: '  ' },
  ])('does not invent intent metadata for %j', (metadata) => {
    const draft = parseReviewHandoff({ ...handoff, ...metadata });
    expect(draft).toMatchObject({ intent: null, intent_source: null });
    const payload: unknown = JSON.parse(JSON.stringify(toApiPayload(draft)));
    expect(payload).not.toHaveProperty('intent');
    expect(payload).not.toHaveProperty('intent_source');
  });

  it.each([
    ['comparison', 'draft_task_type'],
    ['unknown', 'unmapped_task_type'],
  ] as const)('preserves explicit %s metadata', (intent, source) => {
    const draft = parseReviewHandoff({
      ...handoff,
      intent,
      intent_source: source,
    });
    expect(toApiPayload(draft)).toMatchObject({
      intent,
      intent_source: source,
    });
  });

  it('does not invent a source for an explicit intent', () => {
    const draft = parseReviewHandoff({ ...handoff, intent: 'news' });
    expect(draft).toMatchObject({ intent: 'news', intent_source: null });
  });

  it.each([
    { intent_source: 'draft_task_type' },
    { intent: null, intent_source: 'draft_task_type' },
    { intent: '', intent_source: 'draft_task_type' },
  ])('drops an orphan source without an intent for %j', (metadata) => {
    const draft = parseReviewHandoff({ ...handoff, ...metadata });
    expect(draft).toMatchObject({ intent: null, intent_source: null });
    const payload: unknown = JSON.parse(JSON.stringify(toApiPayload(draft)));
    expect(payload).not.toHaveProperty('intent_source');
  });

  it.each([
    { intent: 123 },
    { intent: ['news'] },
    { intent_source: 456 },
    { intent_source: { source: 'draft_task_type' } },
  ])('rejects wrong-typed intent metadata %j', (metadata) => {
    expect(() => parseReviewHandoff({ ...handoff, ...metadata })).toThrow(
      'unsupported'
    );
  });
});
