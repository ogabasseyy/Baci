import type { CategoryHubDefaults } from '@/lib/storefront-category/category-hub-types';
import { CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS } from './category-hub-console-wearable-defaults';
import { CATEGORY_HUB_EXPANSION_DEFAULTS } from './category-hub-expansion-defaults';

export const CATEGORY_HUB_PRIORITY_CATEGORIES = [
  'smartphones',
  'laptops',
  'smart-tvs',
  'gaming-laptops',
  'tablets',
  'audio',
  'smartwatches',
  'playstation-5',
] as const;

export const CATEGORY_HUB_DEFAULTS = {
  smartphones: {
    intro: {
      heading: 'What are the best Smartphones in Nigeria?',
      description:
        'Compare flagship, mid-range, and budget smartphones with clear price bands, camera guidance, and battery-focused picks.',
    },
    trustFeatures: [
      'Warranty-backed smartphone selections',
      'Clear price-band guidance',
      'New and pre-owned options',
      'Fast delivery coverage',
    ],
    faqItems: [
      {
        question: 'What should I look for in a smartphone hub?',
        answer:
          'Focus on camera quality, battery capacity, storage, and the price band that matches your budget.',
      },
      {
        question: 'How do I compare phones fairly?',
        answer:
          'Start with the same category, then compare devices with similar price ranges and meaningful spec differences.',
      },
    ],
    bestFor: {
      photography: {
        title: 'Best for Photography',
        description:
          'Phones with stronger main cameras for sharper everyday and portrait shots.',
      },
      battery: {
        title: 'Best for Battery Life',
        description:
          'Phones with large batteries or faster charging for longer days away from a charger.',
      },
      budget: {
        title: 'Best Budget Phones',
        description:
          'The strongest value picks inside the lowest eligible price band.',
      },
    },
    brandHighlights: {
      heading: 'Popular smartphone brands',
      description:
        'See which brands have the strongest selection in this category.',
    },
    priceBands: [
      {
        slug: 'under-500k',
        title: 'Best Smartphones Under ₦500,000',
        description: 'Entry and value phones inside the first eligible band.',
      },
      {
        slug: 'under-1m',
        title: 'Best Smartphones Under ₦1,000,000',
        description: 'Stronger mid-range and premium options below ₦1,000,000.',
      },
    ],
  },
  laptops: {
    intro: {
      heading: 'Where to buy affordable Laptops in Lagos?',
      description:
        'Find work, school, and performance laptops with clear price bands and practical storage and RAM guidance.',
    },
    trustFeatures: [
      'Work and school laptop guidance',
      'Clear storage and RAM filters',
      'Warranty-aware selections',
      'Reliable delivery options',
    ],
    faqItems: [
      {
        question: 'Which laptop specs matter most?',
        answer:
          'For most buyers, RAM, storage, and battery life are the first specs to compare.',
      },
      {
        question: 'How do I choose a laptop for school?',
        answer:
          'Choose at least 8GB RAM and 256GB storage for a smooth everyday experience.',
      },
    ],
    bestFor: {
      workAndSchool: {
        title: 'Best for Work and School',
        description:
          'Laptop options that handle everyday productivity and learning workloads.',
      },
      performance: {
        title: 'Best for Performance',
        description:
          'Higher-spec laptops for heavier multitasking and demanding apps.',
      },
      budget: {
        title: 'Best Budget Laptops',
        description:
          'Value laptop picks inside the lowest eligible price band.',
      },
    },
    brandHighlights: {
      heading: 'Popular laptop brands',
      description:
        'Spot the brands with the strongest laptop coverage in this catalog.',
    },
    priceBands: [
      {
        slug: 'under-1m',
        title: 'Best Laptops Under ₦1,000,000',
        description: 'Practical laptop choices below the first price ceiling.',
      },
    ],
  },
  'smart-tvs': {
    intro: {
      heading: 'What are the best Smart TVs for your living room?',
      description:
        'Compare big-screen, motion-friendly, and budget smart TVs with clear price guidance.',
    },
    trustFeatures: [
      'Clear screen-size guidance',
      'Motion-focused TV picks',
      'Price-band decision support',
      'Popular TV brands highlighted',
    ],
    faqItems: [
      {
        question: 'Which smart TV size is best?',
        answer:
          'Choose a larger screen for bigger rooms and a higher refresh rate for smoother sports and action content.',
      },
      {
        question: 'What makes a TV budget-friendly?',
        answer:
          'The best budget options deliver the strongest screen and motion mix inside the lowest eligible band.',
      },
    ],
    bestFor: {
      bigScreenViewing: {
        title: 'Best for Big-Screen Viewing',
        description:
          'Larger panels that suit living rooms and shared viewing spaces.',
      },
      fastMotion: {
        title: 'Best for Fast Motion',
        description:
          'TVs with higher refresh rates for smoother sports and action scenes.',
      },
      budget: {
        title: 'Best Budget Smart TVs',
        description: 'Value TV picks inside the lowest eligible price band.',
      },
    },
    brandHighlights: {
      heading: 'Popular smart TV brands',
      description: 'See which TV brands are most represented in this category.',
    },
    priceBands: [
      {
        slug: 'under-2m',
        title: 'Best Smart TVs Under ₦2,000,000',
        description: 'Selected TV options below the first eligible ceiling.',
      },
    ],
  },
  ...CATEGORY_HUB_EXPANSION_DEFAULTS,
  ...CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS,
} satisfies Record<
  (typeof CATEGORY_HUB_PRIORITY_CATEGORIES)[number],
  CategoryHubDefaults
>;
