import { describe, expect, it } from 'vitest';
import { extractFaqItems, hasPublishableFaqContent } from './faq';

describe('extractFaqItems & hasPublishableFaqContent', () => {
  it('returns valid structured faq_items and filters out malformed elements', () => {
    expect(
      extractFaqItems({
        faq_items: [
          null,
          {},
          { question: '  ', answer: 'Valid answer' },
          { question: 'Valid question', answer: '   ' },
          { question: 'How fast is shipping?', answer: 'Same day in Lagos.' },
        ],
      })
    ).toEqual([
      { question: 'How fast is shipping?', answer: 'Same day in Lagos.' },
    ]);
  });

  it('falls back to legacy pages.faq when faq_items has no valid elements', () => {
    expect(
      extractFaqItems({
        faq_items: [{}],
        pages: { faq: 'Q: Do you offer warranty?\nA: Yes, 12 months.' },
      })
    ).toEqual([
      {
        question: 'Do you offer warranty?',
        answer: 'Yes, 12 months.',
        order: 0,
      },
    ]);
  });

  it('treats empty or whitespace-only FAQ data as unpublishable for non-Ogabassey templates', () => {
    expect(
      hasPublishableFaqContent({
        template_id: 'default',
        faq_items: [{}],
        pages: { faq: '   ' },
      })
    ).toBe(false);
  });

  it('treats Ogabassey template as publishable via built-in template FAQs', () => {
    expect(
      hasPublishableFaqContent({
        template_id: 'ogabassey',
        faq_items: [],
        pages: { faq: null },
      })
    ).toBe(true);
  });
});
