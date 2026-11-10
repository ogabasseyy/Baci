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

  it('filters out legacy FAQ entries with empty or whitespace-only answers', () => {
    expect(
      extractFaqItems({
        pages: {
          faq: 'Q: Valid question?\nA: Valid answer.\n\nQ: Unanswered question?\nA:   ',
        },
      })
    ).toEqual([
      {
        question: 'Valid question?',
        answer: 'Valid answer.',
        order: 0,
      },
    ]);

    expect(
      extractFaqItems({
        pages: {
          faq: 'Q: Unanswered question?\nA:   ',
        },
      })
    ).toEqual([]);
  });

  it('filters out structured items with empty markup or whitespace in question or answer', () => {
    expect(
      extractFaqItems({
        faq_items: [
          { question: '<p> </p>', answer: 'Valid answer' },
          { question: '<p>&nbsp;</p>', answer: 'Valid answer' },
          { question: 'Valid question', answer: '<p> </p>' },
          { question: 'Valid question', answer: '<p>&nbsp;</p>' },
          { question: 'Valid question', answer: '<div>&#160;</div>' },
          { question: 'Valid question', answer: '<p>Actual answer</p>' },
        ],
      })
    ).toEqual([{ question: 'Valid question', answer: '<p>Actual answer</p>' }]);
  });

  it('normalizes optional category: keeps trimmed string and omits non-string or whitespace category', () => {
    expect(
      extractFaqItems({
        faq_items: [
          {
            question: 'Question 1',
            answer: 'Answer 1',
            category: { name: 'Support' },
          },
          {
            question: 'Question 2',
            answer: 'Answer 2',
            category: 42,
          },
          {
            question: 'Question 3',
            answer: 'Answer 3',
            category: '   ',
          },
          {
            question: 'Question 4',
            answer: 'Answer 4',
            category: '  Shipping  ',
          },
        ],
      })
    ).toEqual([
      { question: 'Question 1', answer: 'Answer 1' },
      { question: 'Question 2', answer: 'Answer 2' },
      { question: 'Question 3', answer: 'Answer 3' },
      { question: 'Question 4', answer: 'Answer 4', category: 'Shipping' },
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
