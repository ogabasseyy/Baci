import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairsLabFallback } from './repairs-lab-fallback';

describe('RepairsLabFallback', () => {
  it('paints the repair lab LCP copy in the visible page shell', () => {
    render(<RepairsLabFallback hideHero={false} />);

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Don't Ditch It/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Every device repaired is one less in a landfill/i)
    ).toBeInTheDocument();
    const support = document.querySelector('[data-cwv-lcp-support]');
    const fold = document.querySelector('[data-cwv-lcp-fold]');
    expect(support).toBeInTheDocument();
    expect(fold).toBeInTheDocument();
    expect(support).not.toHaveTextContent(/certified technicians/i);
    expect(fold).not.toHaveTextContent(/extend the life/i);
  });

  it('hides branded lab copy when hideHero is set', () => {
    render(<RepairsLabFallback hideHero />);

    expect(
      screen.queryByRole('heading', { name: 'Repair Lab' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Don't Ditch It/i)).not.toBeInTheDocument();
    const status = screen.getByRole('status', { name: 'Loading repair lab' });
    expect(status).not.toHaveClass('sr-only');
    expect(status).toHaveTextContent('Loading repair lab');
  });
});
