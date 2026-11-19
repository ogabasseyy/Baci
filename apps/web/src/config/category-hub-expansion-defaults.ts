import type { CategoryHubDefaults } from '@/lib/storefront-category/category-hub-types';

export const CATEGORY_HUB_EXPANSION_DEFAULTS = {
  'gaming-laptops': {
    intro: {
      heading: 'Which Gaming Laptop Should I Buy?',
      description:
        'Review listed gaming laptops by RAM, display size, price and exact configuration before choosing a model.',
    },
    trustFeatures: [
      'Compare listed prices and exact configurations',
      'Check condition and selected options',
      'Confirm compatibility and included items',
    ],
    faqItems: [
      {
        question: 'How can I choose a gaming laptop within my budget?',
        answer:
          'Start with listed prices, then compare the exact GPU, processor, RAM, storage and screen configuration against the games or applications you use.',
      },
      {
        question: 'Which gaming laptop specifications should I compare?',
        answer:
          'Compare RAM, GPU, processor and display specifications independently. Confirm the selected model, condition and included accessories before ordering.',
      },
    ],
    bestFor: {
      highMemory: {
        title: 'Best 16GB+ RAM Gaming Laptops',
        description:
          'Compare configurations listing at least 16GB RAM; check GPU and display specifications separately.',
      },
      under2m: {
        title: 'Best Gaming Laptops Under ₦2,000,000',
        description:
          'Explore listed gaming laptops priced at or below ₦2,000,000.',
      },
      largeScreen: {
        title: 'Best 16-Inch+ Gaming Laptops',
        description:
          'Compare models listing a screen size of at least 16 inches.',
      },
    },
    brandHighlights: {
      heading: 'Explore the listed brands',
      description:
        'Browse eligible brand pages and available product selections in this category.',
    },
    priceBands: [
      {
        slug: 'under-1-5m',
        title: 'Best Gaming Laptops Under ₦1,500,000',
        description:
          'Compare eligible listed options priced at or below ₦1,500,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-2-5m',
        title: 'Best Gaming Laptops Under ₦2,500,000',
        description:
          'Compare eligible listed options priced at or below ₦2,500,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-4m',
        title: 'Best Gaming Laptops Under ₦4,000,000',
        description:
          'Compare eligible listed options priced at or below ₦4,000,000; verify the selected model, condition and availability.',
      },
    ],
  },
  tablets: {
    intro: {
      heading: 'Which Tablet Fits My Budget and Daily Use?',
      description:
        'Compare listed tablet configurations by price, screen size and battery capacity, then check connectivity and accessory compatibility.',
    },
    trustFeatures: [
      'Compare listed prices and exact configurations',
      'Check condition and selected options',
      'Confirm compatibility and included items',
    ],
    faqItems: [
      {
        question:
          'How should I choose a tablet for study, work or entertainment?',
        answer:
          'Compare screen size, storage, operating system, connectivity and compatible accessories against your tasks, then check the listed price and condition.',
      },
      {
        question: 'How can I compare tablet batteries and connectivity?',
        answer:
          'Review battery capacity alongside model-specific runtime information. Confirm Wi-Fi or cellular support on the selected version and the accessories you need.',
      },
    ],
    bestFor: {
      budget: {
        title: 'Best Budget Tablets',
        description: 'Explore listed tablets priced at or below ₦250,000.',
      },
      battery: {
        title: 'Tablets with 7,000mAh+ Batteries',
        description:
          'Compare tablets listing at least 7,000mAh capacity; actual runtime depends on use and configuration.',
      },
      largeScreen: {
        title: 'Best Large-Screen Tablets',
        description: 'Compare tablets listing screens of at least 10.9 inches.',
      },
    },
    brandHighlights: {
      heading: 'Explore the listed brands',
      description:
        'Browse eligible brand pages and available product selections in this category.',
    },
    priceBands: [
      {
        slug: 'under-200k',
        title: 'Best Tablets Under ₦200,000',
        description:
          'Compare eligible listed options priced at or below ₦200,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-500k',
        title: 'Best Tablets Under ₦500,000',
        description:
          'Compare eligible listed options priced at or below ₦500,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-1m',
        title: 'Best Tablets Under ₦1,000,000',
        description:
          'Compare eligible listed options priced at or below ₦1,000,000; verify the selected model, condition and availability.',
      },
    ],
  },
  audio: {
    intro: {
      heading: 'Which Audio Product Suits My Setup and Budget?',
      description:
        'Browse audio products by price, then verify the exact device type, connections, power requirements and model specifications.',
    },
    trustFeatures: [
      'Compare listed prices and exact configurations',
      'Check condition and selected options',
      'Confirm compatibility and included items',
    ],
    faqItems: [
      {
        question:
          'How should I choose between speakers, earbuds and headphones?',
        answer:
          'Choose the device type for where and how you listen, then compare connections, power requirements, exact specifications and listed prices.',
      },
      {
        question: 'What should I compare before buying an audio product?',
        answer:
          'Check the exact model, connectivity, output or battery specifications where supplied, included accessories and condition. Price bands narrow the list but do not establish performance.',
      },
    ],
    bestFor: {
      budget: {
        title: 'Best Budget Audio Picks',
        description:
          'Explore listed audio products priced at or below ₦100,000.',
      },
      midrange: {
        title: 'Best Mid-Range Audio',
        description:
          'Compare listed audio products above ₦100,000 and at or below ₦500,000.',
      },
      premium: {
        title: 'Best Premium Audio Picks',
        description:
          'Explore listed audio products above ₦500,000; verify output and features on each model.',
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
        title: 'Best Audio & Speakers Under ₦50,000',
        description:
          'Compare eligible listed options priced at or below ₦50,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-150k',
        title: 'Best Audio & Speakers Under ₦150,000',
        description:
          'Compare eligible listed options priced at or below ₦150,000; verify the selected model, condition and availability.',
      },
      {
        slug: 'under-500k',
        title: 'Best Audio & Speakers Under ₦500,000',
        description:
          'Compare eligible listed options priced at or below ₦500,000; verify the selected model, condition and availability.',
      },
    ],
  },
} satisfies Record<'gaming-laptops' | 'tablets' | 'audio', CategoryHubDefaults>;
