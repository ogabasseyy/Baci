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
    ).not.toHaveClass('sr-only');
    expect(
      document.querySelector('[data-cwv-lcp-support]')
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-cwv-lcp-copy="compare"]')
    ).toHaveTextContent('Compare products');
    expect(document.querySelector('[data-cwv-lcp-fold]')).toBeInTheDocument();
  });

  it('marks generic copy as pending when a streamed description will replace it', () => {
    render(<CompareHubIntro description={<p>Resolved copy</p>} />);

    expect(
      document.querySelector('[data-compare-hub-intro-pending]')
    ).not.toBeNull();
    expect(screen.getByText('Resolved copy')).toBeInTheDocument();
  });

  it('falls back to generic store copy when the merchant name is missing', () => {
    render(<CompareHubIntro />);

    expect(
      screen.getByText(/Browse this store product comparison pages by category/)
    ).toBeInTheDocument();
  });
});
