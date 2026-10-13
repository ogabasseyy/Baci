import { describe, expect, it } from 'vitest';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

const animation = {
  animationDelay: 0,
  animationDuration: 'normal',
  animationTrigger: 'scroll',
  animationType: 'fade-in',
};

function candidate(content: unknown[]) {
  return builderPreviewCandidateConfigSchema.safeParse({
    content,
    root: { props: { title: 'Home' } },
  }).success;
}

describe('persisted animated preview candidates', () => {
  it('accepts animation defaults on every render-safe block that declares them', () => {
    expect(
      candidate([
        {
          props: {
            ...animation,
            align: 'left',
            content: 'Supporting copy',
            id: 'text-1',
            title: 'About us',
          },
          type: 'Text',
        },
        {
          props: {
            ...animation,
            columns: 3,
            features: [
              {
                description: 'Fast delivery',
                icon: 'truck',
                title: 'Shipping',
              },
            ],
            id: 'features-1',
            title: 'Why choose us',
          },
          type: 'Features',
        },
        {
          props: {
            ...animation,
            id: 'faq-1',
            items: [{ answer: 'Within days.', question: 'When?' }],
            style: 'accordion',
            title: 'Questions',
          },
          type: 'FAQ',
        },
        {
          props: {
            ...animation,
            id: 'legal-1',
            sections: [{ content: 'Terms apply.', heading: 'Terms' }],
            title: 'Policy',
          },
          type: 'LegalSection',
        },
      ])
    ).toBe(true);
  });

  it('rejects an out-of-range or unknown persisted animation prop', () => {
    expect(
      candidate([
        {
          props: {
            ...animation,
            animationDelay: 6,
            id: 'text-1',
            unexpectedAnimation: 'unsafe',
          },
          type: 'Text',
        },
      ])
    ).toBe(false);
  });
});
