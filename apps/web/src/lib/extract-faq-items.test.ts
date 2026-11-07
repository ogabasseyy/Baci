import { describe, expect, it } from 'vitest';
import { extractFaqItems } from './extract-faq-items';

describe('extractFaqItems', () => {
  it('returns valid structured faq_items and filters out primitives, null, and malformed elements', () => {
    expect(
      extractFaqItems({
        faq_items: [
          null,
          undefined,
          'string',
          123,
          {},
          { question: '', answer: 'Valid' },
          { question: '  ', answer: 'Valid answer' },
          { question: 'Valid question', answer: '' },
          { question: 'Valid question', answer: '   ' },
          { question: 10, answer: 'Valid' },
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

  it('falls back to legacy pages.faq when faq_items is missing', () => {
    expect(
      extractFaqItems({
        pages: { faq: '### Delivery time\nOrders arrive in 24 hours.' },
      })
    ).toEqual([
      {
        question: 'Delivery time',
        answer: 'Orders arrive in 24 hours.',
        order: 0,
      },
    ]);
  });

  it('returns an empty array when neither structured items nor pages.faq exist', () => {
    expect(extractFaqItems({})).toEqual([]);
    expect(extractFaqItems({ faq_items: [], pages: { faq: '   ' } })).toEqual(
      []
    );
    expect(extractFaqItems({ faq_items: null, pages: null })).toEqual([]);
  });
});
