import { describe, expect, it } from 'vitest';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

describe('saved array preview compatibility', () => {
  it('accepts duplicate saved labels and titles without weakening AI patch validation', () => {
    const navigationLinks = [
      { label: 'Shop', url: '/collections/new' },
      { label: 'Shop', url: '/collections/sale' },
    ];
    const features = [
      { description: 'Fast dispatch.', title: 'Shipping' },
      { description: 'Tracked delivery.', title: 'Shipping' },
    ];
    const items = [
      { answer: 'Within three days.', question: 'When do you ship?' },
      { answer: 'On weekdays.', question: 'When do you ship?' },
    ];
    const sections = [
      { content: 'We protect your data.', heading: 'Privacy' },
      { content: 'We retain only what is needed.', heading: 'Privacy' },
    ];

    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          { props: { id: 'header-1', navigationLinks }, type: 'Header' },
          { props: { features, id: 'features-1' }, type: 'Features' },
          { props: { id: 'faq-1', items }, type: 'FAQ' },
          { props: { id: 'legal-1', sections }, type: 'LegalSection' },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(true);

    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'Header',
        'navigationLinks',
        navigationLinks
      )
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'Features',
        'features',
        features
      )
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('FAQ', 'items', items)
    ).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'LegalSection',
        'sections',
        sections
      )
    ).toBe(false);
  });

  it('rejects a saved duplicate navigation label with an unsafe URL', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: {
              id: 'header-1',
              navigationLinks: [
                { label: 'Shop', url: '/collections/new' },
                { label: 'Shop', url: 'javascript:alert(1)' },
              ],
            },
            type: 'Header',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(false);
  });

  it('preserves the allowed empty saved Header navigation array', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [
          {
            props: { id: 'header-1', navigationLinks: [] },
            type: 'Header',
          },
        ],
        root: { props: { title: 'Home' } },
      }).success
    ).toBe(true);
  });
});
