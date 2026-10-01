import { describe, expect, it } from 'vitest';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

describe('saved scalar preview compatibility', () => {
  it('accepts empty Puck text fields without weakening AI mutation validation', () => {
    const candidate = {
      content: [
        {
          props: { ctaText: '', id: 'hero-1', subtitle: '', title: '' },
          type: 'Hero',
        },
        {
          props: { content: '', id: 'text-1', title: '' },
          type: 'Text',
        },
        { props: { id: 'button-1', text: '' }, type: 'Button' },
        { props: { id: 'products-1', title: '' }, type: 'ProductGrid' },
        {
          props: { author: '', id: 'testimonial-1', quote: '', role: '' },
          type: 'Testimonial',
        },
        {
          props: { id: 'features-1', subtitle: '', title: '' },
          type: 'Features',
        },
        {
          props: {
            buttonText: '',
            description: '',
            id: 'newsletter-1',
            placeholder: '',
            title: '',
          },
          type: 'Newsletter',
        },
        { props: { copyrightText: '', id: 'footer-1' }, type: 'Footer' },
        { props: { id: 'faq-1', subtitle: '', title: '' }, type: 'FAQ' },
        {
          props: { id: 'legal-1', lastUpdated: '', title: '' },
          type: 'LegalSection',
        },
      ],
      root: { props: { title: 'Home' } },
    };

    expect(
      builderPreviewCandidateConfigSchema.safeParse(candidate).success
    ).toBe(true);

    expect(
      builderDesignCapabilityAdapter.isPropValue('Hero', 'ctaText', '')
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Text', 'title', '')
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Button', 'text', '')
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('Newsletter', 'buttonText', '')
    ).toBe(false);
  });

  it('keeps saved text scalar bounds in the preview policy', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { ctaText: 'a'.repeat(121), id: 'hero-1' },
            type: 'Hero',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(false);
  });
});
