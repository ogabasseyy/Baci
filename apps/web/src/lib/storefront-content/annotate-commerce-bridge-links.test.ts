import { describe, expect, it } from 'vitest';
import { annotateCommerceBridgeLinks } from './annotate-commerce-bridge-links';

describe('annotateCommerceBridgeLinks', () => {
  it('annotates price-band, compare, and catalog hub links with contextual descriptions', () => {
    const links = [
      {
        href: 'https://ogabassey.com/smartphones/best-under/500000',
        label: 'Best under ₦500,000',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
        label: 'Apple vs Samsung',
      },
      {
        href: 'https://ogabassey.com/smartphones/apple',
        label: 'Apple iPhones',
      },
    ];

    const annotated = annotateCommerceBridgeLinks(links, 'Smartphones');

    expect(annotated).toEqual([
      {
        href: 'https://ogabassey.com/smartphones/best-under/500000',
        label: 'Best under ₦500,000',
        description:
          'Compare verified prices and in-stock options within this budget tier.',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
        label: 'Apple vs Samsung',
        description:
          'Review side-by-side specifications, price difference, and buying fit.',
      },
      {
        href: 'https://ogabassey.com/smartphones/apple',
        label: 'Apple iPhones',
        description:
          'Explore verified smartphones listings with condition and stock details.',
      },
    ]);
  });

  it('preserves existing non-empty descriptions', () => {
    const links = [
      {
        href: 'https://ogabassey.com/smartphones/best-under/500000',
        label: 'Best under ₦500,000',
        description: 'Custom curated description',
      },
    ];

    const annotated = annotateCommerceBridgeLinks(links, 'Smartphones');
    expect(annotated[0]?.description).toBe('Custom curated description');
  });
});
