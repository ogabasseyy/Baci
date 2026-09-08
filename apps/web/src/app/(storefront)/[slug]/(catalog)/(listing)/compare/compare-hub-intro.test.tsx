import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompareHubIntro } from './compare-hub-intro';

describe('CompareHubIntro', () => {
  it('renders the compare hub heading and merchant description', () => {
    render(<CompareHubIntro merchantName="Ogabassey" />);

    expect(
      screen.getByRole('heading', { name: 'Compare products' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Browse Ogabassey product comparison pages by category/)
    ).toBeInTheDocument();
  });

  it('falls back to generic store copy when the merchant name is missing', () => {
    render(<CompareHubIntro />);

    expect(
      screen.getByText(/Browse this store product comparison pages by category/)
    ).toBeInTheDocument();
  });
});
