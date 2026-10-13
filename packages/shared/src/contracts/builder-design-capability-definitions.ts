import {
  allow,
  type BuilderDesignCapability,
  copy,
  deny,
  featureList,
  fixedPlacement,
  headerProps,
  heroProps,
  label,
  safeLink,
  safeTextProps,
} from './builder-design-capability-props';

export const builderDesignCapabilityDefinitions: BuilderDesignCapability[] = [
  deny(
    'OgabasseyHeader',
    'Merchant-specific header.',
    'merchant-specific',
    'This merchant-specific block is not available to AI.'
  ),
  deny(
    'OgabasseyHero',
    'Merchant-specific hero.',
    'merchant-specific',
    'This merchant-specific block is not available to AI.'
  ),
  deny(
    'OgabasseyNav',
    'Merchant-specific navigation.',
    'merchant-specific',
    'This merchant-specific block is not available to AI.'
  ),
  deny(
    'OgabasseyCategories',
    'Merchant-specific categories.',
    'merchant-specific',
    'This merchant-specific block is not available to AI.'
  ),
  deny(
    'OgabasseyUtilities',
    'Merchant-specific utilities.',
    'merchant-specific',
    'This merchant-specific block is not available to AI.'
  ),
  allow(
    'Header',
    'Store navigation.',
    headerProps,
    false,
    true,
    fixedPlacement
  ),
  {
    ...allow('Hero', 'Prominent collection callout.', heroProps),
    initialProps: { headingLevel: 'h2' },
  },
  {
    ...allow(
      'HeroCarousel',
      'Rotating hero slides.',
      {},
      false,
      true,
      fixedPlacement
    ),
    specialOperations: {
      updateCarouselSlide: {
        ctaLink: safeLink,
        ctaText: { ...label(), required: true },
        subtitle: copy(),
        title: { ...label(), required: true },
      },
    },
  },
  allow('Text', 'Supporting storefront copy.', safeTextProps),
  deny(
    'Image',
    'Image asset block.',
    'media-review',
    'AI cannot select media until the asset pipeline is reviewed.'
  ),
  allow('Button', 'Call to action.', {
    align: {
      default: 'center',
      enum: ['left', 'center', 'right'],
      type: 'enum',
    },
    link: { ...safeLink, default: '/' },
    size: { default: 'default', enum: ['sm', 'default', 'lg'], type: 'enum' },
    text: { ...label('Click Me'), required: true },
    variant: {
      default: 'primary',
      enum: ['primary', 'background', 'accent'],
      type: 'enum',
    },
  }),
  allow('ProductGrid', 'Catalog product collection.', {
    columns: {
      default: 3,
      maximum: 4,
      minimum: 2,
      type: 'number',
      wholeNumber: true,
    },
    limit: {
      default: 6,
      maximum: 24,
      minimum: 1,
      type: 'number',
      wholeNumber: true,
    },
    showFilters: { default: true, type: 'boolean' },
    title: { ...label('Featured products'), required: true },
  }),
  allow('Testimonial', 'Customer social proof.', {
    author: { ...label('Name'), required: true },
    quote: { ...copy('Add a customer quote.'), required: true },
    rating: {
      default: 0,
      maximum: 5,
      minimum: 0,
      type: 'number',
      wholeNumber: true,
    },
    role: { ...label('Role'), required: true },
  }),
  allow('Features', 'Feature benefit list.', {
    columns: {
      default: 3,
      maximum: 4,
      minimum: 2,
      type: 'number',
      wholeNumber: true,
    },
    features: featureList,
    subtitle: copy(),
    title: { ...label('Why choose us'), required: true },
  }),
  allow('Newsletter', 'Email signup invitation.', {
    buttonText: { ...label('Subscribe'), required: true },
    description: {
      ...copy('Sign up for updates from this store.'),
      required: true,
    },
    placeholder: label('Enter your email'),
    title: { ...label('Newsletter signup'), required: true },
  }),
  allow('Spacer', 'Vertical rhythm.', {
    height: {
      default: 'medium',
      enum: ['small', 'medium', 'large', 'xlarge'],
      type: 'enum',
    },
  }),
  allow(
    'Footer',
    'Store footer.',
    {
      copyrightText: { ...copy(), required: true },
      quickLinks: {
        item: {
          properties: {
            label: { ...label(), required: true },
            url: { ...safeLink, required: true },
          },
          uniqueBy: 'label',
        },
        maximumItems: 8,
        type: 'array',
      },
      showNewsletter: { type: 'boolean' },
      showQuickLinks: { type: 'boolean' },
    },
    false,
    true,
    fixedPlacement
  ),
  deny(
    'Video',
    'Embedded video.',
    'network-embed',
    'AI cannot add third-party embeds without a network and sandbox review.'
  ),
  deny(
    'Map',
    'Embedded map.',
    'network-embed',
    'AI cannot add third-party embeds without a network and sandbox review.'
  ),
  deny(
    'InstagramFeed',
    'External social feed.',
    'network-embed',
    'AI cannot add third-party feeds without a network and privacy review.'
  ),
  deny(
    'ContactForm',
    'Storefront form submission.',
    'data-collection',
    'AI cannot change data-collection forms without a submission-flow review.'
  ),
  deny(
    'SocialIcons',
    'External social links.',
    'external-navigation',
    'AI cannot create external navigation until link destinations are reviewed.'
  ),
  deny(
    'CodeEmbed',
    'Custom HTML or JavaScript.',
    'unsafe-code',
    'Custom code is not available to AI because it can bypass storefront safety controls.'
  ),
  deny(
    'Search',
    'Catalog search control.',
    'data-behavior',
    'AI cannot change catalog search behavior without a data-query review.'
  ),
  allow('FAQ', 'Frequently asked questions.', {
    items: {
      default: [{ answer: 'Answer this question.', question: 'A question' }],
      item: {
        properties: {
          answer: { ...copy(), required: true },
          question: { ...label(), required: true },
        },
        uniqueBy: 'question',
      },
      maximumItems: 12,
      minimumItems: 1,
      type: 'array',
    },
    style: {
      default: 'accordion',
      enum: ['accordion', 'grid', 'list'],
      type: 'enum',
    },
    subtitle: copy(),
    title: { ...label('Frequently Asked Questions'), required: true },
  }),
  deny(
    'AboutSection',
    'About section with media.',
    'media-review',
    'AI cannot select media until the asset pipeline is reviewed.'
  ),
  deny(
    'ContactSection',
    'Contact details, map, and form.',
    'data-collection',
    'AI cannot change contact collection or embeds without review.'
  ),
  allow(
    'LegalSection',
    'Store policy copy.',
    {
      lastUpdated: label(),
      sections: {
        default: [{ content: 'Policy details.', heading: 'Introduction' }],
        item: {
          properties: {
            content: { ...copy(), required: true },
            heading: { ...label(), required: true },
          },
          uniqueBy: 'heading',
        },
        maximumItems: 12,
        minimumItems: 1,
        type: 'array',
      },
      title: { ...label('Privacy Policy'), required: true },
    },
    false,
    true
  ),
  deny(
    'CountdownTimer',
    'Time-dependent promotion.',
    'renderer-state',
    'AI cannot add timers until date validation and expiry behavior are reviewed.'
  ),
  deny(
    'TrustBadges',
    'Trust badge icons.',
    'renderer-review',
    'AI cannot select badge icons until the renderer icon allowlist is reviewed.'
  ),
  deny(
    'AnnouncementBar',
    'Dismissible storefront notice.',
    'renderer-state',
    'AI cannot change dismissible notices until client-state behavior is reviewed.'
  ),
];
