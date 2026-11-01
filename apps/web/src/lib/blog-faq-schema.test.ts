import { describe, expect, it } from 'vitest';
import { extractBlogFaqItems, generateFaqPageSchema } from './blog-faq-schema';

function faqBlock(index: number): string {
  return `
    <h3>Question number ${index} for Nigerian buyers?</h3>
    <p>This answer gives enough useful buying context for item ${index}.</p>
  `;
}

describe('extractBlogFaqItems', () => {
  it('extracts visible FAQ h3 question blocks from the FAQ section only', () => {
    const items = extractBlogFaqItems(`
      <h2>Buying context</h2>
      <h3>Should this not count?</h3><p>This appears before the FAQ section.</p>
      <h2>FAQ</h2>
      <h3>Is the Pixel Watch 3 good for Android buyers?</h3>
      <p>Yes, if the buyer wants Google ecosystem features and accepts the battery trade-off.</p>
      <h3>Should Nigerian buyers compare it with Galaxy Watch?</h3>
      <p>Yes. Compare Android compatibility, battery life, warranty, and available straps before choosing.</p>
      <h2>Verdict</h2>
      <h3>Should this not count either?</h3><p>This appears after the FAQ section.</p>
    `);

    expect(items).toEqual([
      {
        question: 'Is the Pixel Watch 3 good for Android buyers?',
        answer:
          'Yes, if the buyer wants Google ecosystem features and accepts the battery trade-off.',
      },
      {
        question: 'Should Nigerian buyers compare it with Galaxy Watch?',
        answer:
          'Yes. Compare Android compatibility, battery life, warranty, and available straps before choosing.',
      },
    ]);
  });

  it('returns an empty list when no FAQ section exists', () => {
    expect(
      extractBlogFaqItems('<h2>Buying guide</h2><h3>Is this ignored?</h3>')
    ).toEqual([]);
  });

  it('filters malformed questions and short answers', () => {
    const items = extractBlogFaqItems(`
      <h2>FAQ</h2>
      <h3>No question mark</h3><p>This answer is long enough but the heading is not a question.</p>
      <h3>Why?</h3><p>This answer is long enough but the question is too short.</p>
      <h3>Is this answer too short?</h3><p>Too short.</p>
      <h3>Is this a valid buyer question?</h3><p>This answer is long enough to be eligible for FAQ structured data.</p>
    `);

    expect(items).toEqual([
      {
        question: 'Is this a valid buyer question?',
        answer:
          'This answer is long enough to be eligible for FAQ structured data.',
      },
    ]);
  });

  it('deduplicates questions case-insensitively', () => {
    const items = extractBlogFaqItems(`
      <h2>Frequently Asked Questions</h2>
      <h3>Is this phone good for gaming?</h3><p>Yes, for casual games and everyday performance in this price range.</p>
      <h3>is this phone good for gaming?</h3><p>This duplicate should be ignored even with different casing.</p>
    `);

    expect(items).toEqual([
      {
        question: 'Is this phone good for gaming?',
        answer:
          'Yes, for casual games and everyday performance in this price range.',
      },
    ]);
  });

  it('caps extracted FAQ items at six questions', () => {
    const items = extractBlogFaqItems(
      `<h2>FAQs</h2>${Array.from({ length: 8 }, (_, index) =>
        faqBlock(index + 1)
      ).join('')}`
    );

    expect(items).toHaveLength(6);
    expect(items.at(-1)?.question).toBe(
      'Question number 6 for Nigerian buyers?'
    );
  });

  it('truncates long questions and answers at word boundaries', () => {
    const longQuestion = `Should Nigerian buyers verify ${'warranty '.repeat(30)}before paying?`;
    const longAnswer = `Buyers should compare ${'price warranty stock delivery '.repeat(40)}before deciding.`;

    const [item] = extractBlogFaqItems(`
      <h2>FAQ</h2>
      <h3>${longQuestion}</h3><p>${longAnswer}</p>
    `);

    expect(item.question.length).toBeLessThanOrEqual(180);
    expect(item.answer.length).toBeLessThanOrEqual(600);
    expect(item.question.endsWith(' ')).toBe(false);
    expect(item.answer.endsWith(' ')).toBe(false);
    expect(longQuestion.startsWith(item.question)).toBe(true);
    expect(longAnswer.startsWith(item.answer)).toBe(true);
  });

  it('strips HTML tags while preserving visible entity text', () => {
    const items = extractBlogFaqItems(`
      <h2>FAQ</h2>
      <h3><span>Should buyers compare JBL & Harman Kardon?</span></h3>
      <div><strong>Yes.</strong> Compare warranty, wattage, inputs, and room size before paying.</div>
    `);

    expect(items).toEqual([
      {
        question: 'Should buyers compare JBL & Harman Kardon?',
        answer:
          'Yes. Compare warranty, wattage, inputs, and room size before paying.',
      },
    ]);
  });

  it('extracts FAQ items when the heading includes contextual topic suffixes or People Also Ask', () => {
    const items = extractBlogFaqItems(`
      <h2>Frequently Asked Questions About Tecno Camon Slim</h2>
      <h3>Is the Tecno Camon Slim available in 5G in Nigeria?</h3>
      <p>Yes, buyers can choose between the 4G and 5G variants depending on local carrier support and budget.</p>
    `);
    const paaItems = extractBlogFaqItems(`
      <h2>People Also Ask</h2>
      <h3>Does the Tecno Camon Slim support fast charging?</h3>
      <p>Yes, it supports 45W wired fast charging out of the box for Nigerian power conditions.</p>
    `);

    expect(items).toEqual([
      {
        question: 'Is the Tecno Camon Slim available in 5G in Nigeria?',
        answer:
          'Yes, buyers can choose between the 4G and 5G variants depending on local carrier support and budget.',
      },
    ]);
    expect(paaItems).toEqual([
      {
        question: 'Does the Tecno Camon Slim support fast charging?',
        answer:
          'Yes, it supports 45W wired fast charging out of the box for Nigerian power conditions.',
      },
    ]);
  });

  it('continues scanning later FAQ headings when an earlier People Also Ask section has no valid Q&A blocks', () => {
    const items = extractBlogFaqItems(`
      <h2>People Also Ask</h2>
      <p>Introductory note without question subheadings.</p>
      <h2>Frequently Asked Questions</h2>
      <h3>How long does Tecno Camon Slim battery last?</h3>
      <p>The 5200mAh silicon-carbon battery easily lasts a full day of mixed 4G and 5G use.</p>
    `);

    expect(items).toEqual([
      {
        question: 'How long does Tecno Camon Slim battery last?',
        answer:
          'The 5200mAh silicon-carbon battery easily lasts a full day of mixed 4G and 5G use.',
      },
    ]);
  });
});

describe('generateFaqPageSchema', () => {
  it('returns null for an empty FAQ item list', () => {
    expect(generateFaqPageSchema([])).toBeNull();
  });

  it('builds FAQPage schema from extracted visible questions', () => {
    const schema = generateFaqPageSchema([
      {
        question: 'Is the Pixel Watch 3 good for Android buyers?',
        answer: 'Yes, for buyers who want Google ecosystem features.',
      },
    ]);

    expect(schema).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is the Pixel Watch 3 good for Android buyers?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, for buyers who want Google ecosystem features.',
          },
        },
      ],
    });
  });
});
