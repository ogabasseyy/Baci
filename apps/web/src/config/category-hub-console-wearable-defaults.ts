import type { CategoryHubDefaults } from '@/lib/storefront-category/category-hub-types';

export const CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS = {
  smartwatches: {
    intro: {
      heading: 'Which Smartwatch Works with My Phone and Budget?',
      description:
        'Compare listed smartwatch price ranges, then confirm phone compatibility, model generation, connectivity and size.',
    },
    trustFeatures: [
      'Compare listed prices and exact configurations',
      'Check condition and selected options',
      'Confirm compatibility and included items',
    ],
    faqItems: [
      {
        question: 'How can I choose a smartwatch for my phone?',
        answer:
          'Start with phone and operating-system compatibility, then compare watch generation, size, supported functions and listed price.',
      },
      {
        question: 'How should I compare smartwatch connectivity and features?',
        answer:
          'Check Bluetooth, GPS or cellular support on the selected model and any compatibility requirements. Review model-specific battery and durability information rather than inferring features from price.',
      },
    ],
    bestFor: {
      budget: {
        title: 'Best Budget Smartwatches',
        description: 'Explore listed smartwatches priced at or below ₦150,000.',
      },
      midrange: {
        title: 'Best Mid-Range Smartwatches',
        description:
          'Compare listed smartwatches above ₦150,000 and at or below ₦400,000.',
      },
      premium: {
        title: 'Best Premium Smartwatches',
        description:
          'Explore listed smartwatches above ₦400,000; check connectivity and durability claims on the exact model.',
      },
    },
    brandHighlights: {
      heading: 'Explore the listed brands',
      description:
        'Browse eligible brand pages and available product selections in this category.',
    },
    priceBands: [
      {
        slug: 'under-100k',
        title: 'Best Smartwatches Under ₦100,000',
        description:
          'Compare eligible listed options priced at or below ₦100,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-300k',
        title: 'Best Smartwatches Under ₦300,000',
        description:
          'Compare eligible listed options priced at or below ₦300,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-600k',
        title: 'Best Smartwatches Under ₦600,000',
        description:
          'Compare eligible listed options priced at or below ₦600,000; verify the selected model, condition and availability.',
      },
    ],
  },
  'playstation-5': {
    intro: {
      heading:
        'Which PlayStation 5 Game, Console or Accessory Should I Choose?',
      description:
        'Browse listed PS5 products by price, then check whether each listing is a game, accessory, console or bundle and confirm compatibility.',
    },
    trustFeatures: [
      'Compare listed prices and exact configurations',
      'Check condition and selected options',
      'Confirm compatibility and included items',
    ],
    faqItems: [
      {
        question: 'How can I compare PS5 products within my budget?',
        answer:
          'Use price ranges to narrow listings, then identify whether each item is a game, accessory, console or bundle and compare its exact contents.',
      },
      {
        question: 'What should I check before buying a PS5 game or accessory?',
        answer:
          'Confirm platform generation, disc or digital format, edition, region compatibility, supported console and included items on the exact listing.',
      },
    ],
    bestFor: {
      under50k: {
        title: 'Best PS5 Picks Under ₦50,000',
        description: 'Explore listed PS5 products priced at or below ₦50,000.',
      },
      midTier: {
        title: 'Best PS5 Picks (Above ₦50,000–₦120,000)',
        description:
          'Compare listed PS5 products above ₦50,000 and at or below ₦120,000.',
      },
      upperTier: {
        title: 'Best High-Ticket PS5 Picks (₦400,000+)',
        description:
          'Explore listed PS5 products priced at or above ₦400,000; price alone does not identify a console or bundle.',
      },
    },
    brandHighlights: {
      heading: 'Explore the listed brands',
      description:
        'Browse eligible brand pages and available product selections in this category.',
    },
    priceBands: [
      {
        slug: 'under-50k',
        title: 'Best PlayStation 5 Picks Under ₦50,000',
        description:
          'Compare eligible listed options priced at or below ₦50,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-100k',
        title: 'Best PlayStation 5 Picks Under ₦100,000',
        description:
          'Compare eligible listed options priced at or below ₦100,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-1m',
        title: 'Best PlayStation 5 Picks Under ₦1,000,000',
        description:
          'Compare eligible listed options priced at or below ₦1,000,000; verify the selected model, condition and availability.',
      },
    ],
  },
} satisfies Record<'smartwatches' | 'playstation-5', CategoryHubDefaults>;
