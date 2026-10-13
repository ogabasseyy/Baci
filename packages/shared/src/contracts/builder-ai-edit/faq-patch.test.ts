import { describe, expect, it } from 'vitest';
import { faqPatchSchema } from './faq-patch';

describe('faqPatchSchema', () => {
  it('requires unique bounded questions', () => {
    expect(
      faqPatchSchema.safeParse({
        componentType: 'FAQ',
        items: [
          { answer: 'Within three days.', question: 'When do you ship?' },
          { answer: 'By email.', question: 'How do I get help?' },
        ],
      }).success
    ).toBe(true);
    expect(
      faqPatchSchema.safeParse({
        componentType: 'FAQ',
        items: [
          { answer: 'First.', question: 'Duplicate?' },
          { answer: 'Second.', question: 'Duplicate?' },
        ],
      }).success
    ).toBe(false);
  });
});
