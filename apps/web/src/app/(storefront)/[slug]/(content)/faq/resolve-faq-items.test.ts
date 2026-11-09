import { describe, expect, it } from 'vitest';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { resolveStorefrontFaqItems } from './resolve-faq-items';

describe('resolveStorefrontFaqItems', () => {
  it('returns normalized custom FAQs with approved policy overrides for Ogabassey merchant', () => {
    const merchant = {
      slug: 'ogabassey',
      template_id: OGABASSEY_TEMPLATE_ID,
      faq_items: [
        { question: 'What is your return policy?', answer: '7 days return' },
        { question: 'Do you deliver to Abuja?', answer: 'Yes, nationwide.' },
      ],
      pages: {},
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      question: 'What is your return policy?',
      answer: expect.stringContaining('14 days'),
    });
    expect(items[1]).toEqual({
      question: 'Do you deliver to Abuja?',
      answer: 'Yes, nationwide.',
    });
  });

  it('preserves custom FAQs without policy overrides for unrelated merchants', () => {
    const customFaqs = [
      {
        question: 'What is your return policy?',
        answer: '3 days exchange only.',
      },
      { question: 'Where is your shop located?', answer: 'Ikeja, Lagos.' },
    ];
    const merchant = {
      slug: 'tech-hub',
      faq_items: customFaqs,
      pages: {},
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items).toEqual(customFaqs);
  });

  it('extracts and normalizes legacy string FAQs for Ogabassey merchant', () => {
    const merchant = {
      slug: 'ogabassey',
      faq_items: [],
      pages: {
        faq: 'Q: How does the warranty work?\nA: 3 months warranty',
      },
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items).toHaveLength(1);
    expect(items[0]?.answer).toEqual(expect.stringContaining('one-year'));
  });

  it('returns fallback help FAQs with approved policy overrides for Ogabassey template merchant without custom FAQs', () => {
    const merchant = {
      slug: 'ogabassey',
      template_id: OGABASSEY_TEMPLATE_ID,
      faq_items: [],
      pages: {},
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items.length).toBeGreaterThan(0);
    const returnFaq = items.find((item) =>
      item.question.toLowerCase().includes('return policy')
    );
    expect(returnFaq?.answer).toContain('14 days');
    const warrantyFaq = items.find((item) =>
      item.question.toLowerCase().includes('warranty')
    );
    expect(warrantyFaq?.answer).toContain('one-year');
    const installmentFaq = items.find((item) =>
      item.question.toLowerCase().includes('installment')
    );
    expect(installmentFaq?.answer).toContain('Buy Now, Pay Later');
    const swapFaq = items.find((item) =>
      item.question.toLowerCase().includes('swap')
    );
    expect(swapFaq?.answer).toContain('Swap & Trade-in');
  });

  it('returns empty array for non-Ogabassey merchant using Ogabassey template with no custom FAQs', () => {
    const merchant = {
      slug: 'custom-tenant',
      template_id: OGABASSEY_TEMPLATE_ID,
      faq_items: [],
      pages: {},
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items).toEqual([]);
  });

  it('returns empty array for non-Ogabassey merchant with no custom FAQs', () => {
    const merchant = {
      slug: 'another-store',
      template_id: 'default',
      faq_items: [],
      pages: {},
    };

    const items = resolveStorefrontFaqItems(merchant);

    expect(items).toEqual([]);
  });

  it('handles merchant with undefined or null properties gracefully', () => {
    expect(resolveStorefrontFaqItems({})).toEqual([]);
    expect(
      resolveStorefrontFaqItems({
        slug: null,
        template_id: null,
        faq_items: null,
        pages: null,
      })
    ).toEqual([]);
  });
});
