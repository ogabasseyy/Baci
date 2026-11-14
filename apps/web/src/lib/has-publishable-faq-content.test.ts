import { describe, expect, it } from 'vitest';
import { hasPublishableFaqContent } from './has-publishable-faq-content';

describe('hasPublishableFaqContent', () => {
  it('treats empty or whitespace-only FAQ data as unpublishable for non-Ogabassey templates', () => {
    expect(
      hasPublishableFaqContent({
        template_id: 'default',
        faq_items: [{}],
        pages: { faq: '   ' },
      })
    ).toBe(false);
  });

  it('treats Ogabassey template as publishable for the ogabassey tenant via built-in template FAQs', () => {
    expect(
      hasPublishableFaqContent({
        slug: 'ogabassey',
        template_id: 'ogabassey',
        faq_items: [],
        pages: { faq: null },
      })
    ).toBe(true);
  });

  it('treats Ogabassey template as unpublishable for other tenants when no custom FAQs exist', () => {
    expect(
      hasPublishableFaqContent({
        slug: 'other-store',
        template_id: 'ogabassey',
        faq_items: [],
        pages: { faq: null },
      })
    ).toBe(false);
  });

  it('returns true when valid structured faq_items exist', () => {
    expect(
      hasPublishableFaqContent({
        template_id: 'default',
        faq_items: [{ question: 'Return policy?', answer: '30 days.' }],
      })
    ).toBe(true);
  });

  it('returns true when legacy pages.faq has non-empty text', () => {
    expect(
      hasPublishableFaqContent({
        template_id: 'default',
        pages: { faq: 'Q: How to track order?\nA: Check your email.' },
      })
    ).toBe(true);
  });

  it('returns false when merchant is empty or has null fields', () => {
    expect(hasPublishableFaqContent({})).toBe(false);
    expect(
      hasPublishableFaqContent({
        template_id: null,
        faq_items: null,
        pages: null,
      })
    ).toBe(false);
  });
});
