import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompareMethodology } from './compare-methodology';

describe('CompareMethodology', () => {
  it('explains missing-data and verification limits even when no primary reference exists', () => {
    render(
      <CompareMethodology
        leftLabel="Phone A"
        rightLabel="Phone B"
        productSlugs={['unknown-phone']}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'How to use this comparison' })
    ).toBeVisible();
    expect(screen.getByText(/rows for Phone A and Phone B/)).toBeVisible();
    expect(
      screen.getByText(/Not documented means a fact is missing/)
    ).toHaveTextContent(
      'it does not represent hands-on testing or independent manufacturer verification'
    );
    expect(
      screen.queryByRole('region', { name: 'Manufacturer references' })
    ).not.toBeInTheDocument();
  });
  it('lets buyers inspect a deduplicated primary reference without claiming it certifies the catalog', () => {
    render(
      <CompareMethodology
        leftLabel="Steam Deck"
        rightLabel="Steam Deck OLED"
        productSlugs={['steam-deck', 'steam-deck-oled']}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', {
        name: 'Valve: Steam Deck LCD and OLED specifications',
      })
    ).toHaveAttribute('href', 'https://www.steamdeck.com/en/tech/oled');
    expect(
      screen.getByText(/a reference link is not a certification/)
    ).toBeVisible();
  });
});
