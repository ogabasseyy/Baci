import { describe, expect, it } from 'vitest';
import {
  builderDesignCapabilities,
  getBuilderDesignCapabilityProviderBrief,
} from './builder-design-capabilities';

const registeredComponentTypes = [
  'OgabasseyHeader',
  'OgabasseyHero',
  'OgabasseyNav',
  'OgabasseyCategories',
  'OgabasseyUtilities',
  'Header',
  'Hero',
  'HeroCarousel',
  'Text',
  'Image',
  'Button',
  'ProductGrid',
  'Testimonial',
  'Features',
  'Newsletter',
  'Spacer',
  'Footer',
  'Video',
  'Map',
  'InstagramFeed',
  'ContactForm',
  'SocialIcons',
  'CodeEmbed',
  'Search',
  'FAQ',
  'AboutSection',
  'ContactSection',
  'LegalSection',
  'CountdownTimer',
  'TrustBadges',
  'AnnouncementBar',
] as const;

describe('builder design capabilities', () => {
  it('classifies every registered Puck component with an explicit AI policy', () => {
    const capabilityTypes = builderDesignCapabilities.components.map(
      ({ componentType }) => componentType
    );

    expect(capabilityTypes).toEqual(registeredComponentTypes);
    expect(builderDesignCapabilities.components).toHaveLength(31);
    expect(
      builderDesignCapabilities.components.every(
        (capability) =>
          capability.renderable &&
          typeof capability.aiEditable === 'boolean' &&
          typeof capability.aiInsertable === 'boolean' &&
          typeof capability.protected === 'boolean' &&
          typeof capability.refused === 'boolean'
      )
    ).toBe(true);
  });

  it('publishes bounded editable schemas and safe placement rules', () => {
    const header = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Header'
    );
    const features = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Features'
    );
    const legalSection = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'LegalSection'
    );
    const button = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Button'
    );
    const productGrid = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'ProductGrid'
    );
    const newsletter = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Newsletter'
    );
    const testimonial = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'Testimonial'
    );

    expect(header).toMatchObject({
      aiEditable: true,
      aiInsertable: false,
      protected: true,
      props: {
        navigationLinks: {
          item: {
            properties: {
              label: { maximumLength: 120, required: true, type: 'string' },
              url: { maximumLength: 512, required: true, type: 'safe-link' },
            },
            uniqueBy: 'label',
          },
          maximumItems: 8,
          type: 'array',
        },
      },
    });
    expect(features).toMatchObject({
      aiEditable: true,
      aiInsertable: true,
      props: {
        features: {
          item: { uniqueBy: 'title' },
          maximumItems: 8,
          minimumItems: 1,
          type: 'array',
        },
      },
      placement: { allowedCollections: ['content', 'zones'], kind: 'content' },
    });
    expect(legalSection).toMatchObject({
      aiEditable: true,
      aiInsertable: false,
    });
    expect(button?.props.text).toMatchObject({ required: true });
    expect(productGrid?.props.columns).toMatchObject({
      maximum: 4,
      minimum: 2,
    });
    expect(newsletter?.props.buttonText).toMatchObject({ required: true });
    expect(newsletter?.props.description).toMatchObject({ required: true });
    expect(newsletter?.props.title).toMatchObject({ required: true });
    expect(testimonial?.props.author).toMatchObject({ required: true });
    expect(testimonial?.props.quote).toMatchObject({ required: true });
  });

  it('keeps unsafe renderer and network boundaries refused with relayable reasons', () => {
    const refused = builderDesignCapabilities.components.filter(
      ({ refused: isRefused }) => isRefused
    );
    const codeEmbed = refused.find(
      ({ componentType }) => componentType === 'CodeEmbed'
    );

    expect(codeEmbed?.refusal).toMatchObject({
      code: 'unsafe-code',
      message:
        'Custom code is not available to AI because it can bypass storefront safety controls.',
    });
    expect(
      refused.every(
        ({ refusal }) =>
          refusal !== undefined &&
          refusal.message.length > 0 &&
          refusal.message.length <= 240
      )
    ).toBe(true);
  });

  it('turns creative requests into supported affordances and explicit refusals', () => {
    const brief = getBuilderDesignCapabilityProviderBrief(
      builderDesignCapabilities
    );

    expect(brief).toContain('Features: insert and edit');
    expect(brief).toContain('theme tokens: primary, secondary, accent');
    expect(brief).toContain('CodeEmbed: unsafe-code');
  });
});
