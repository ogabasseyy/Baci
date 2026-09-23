import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GamingGraphicsHubIntro } from './gaming-graphics-hub-intro';

describe('GamingGraphicsHubIntro', () => {
  it('answers the shopping intent and links to sibling GPU hubs', () => {
    render(
      <GamingGraphicsHubIntro
        availableHubs={[
          { slug: 'rtx-4060', model: '4060', label: 'RTX 4060' },
          { slug: 'rtx-4070', model: '4070', label: 'RTX 4070' },
        ]}
        categorySlug="gaming-laptops"
        countryName="Nigeria"
        currentHub={{ slug: 'rtx-4070', model: '4070', label: 'RTX 4070' }}
        merchantName="Ogabassey"
        productCount={12}
        storeUrl="https://ogabassey.com"
      />
    );

    expect(
      screen.getByRole('heading', {
        name: 'RTX 4070 Gaming Laptops in Nigeria',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/compare 12 currently listed/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'RTX 4060 laptops' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/gaming-laptops/graphics/rtx-4060'
    );
  });
});
