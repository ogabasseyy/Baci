import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairsLabFallback } from './repairs-lab-fallback';

describe('RepairsLabFallback', () => {
  it('paints the repair lab LCP copy in the visible page shell', () => {
    render(<RepairsLabFallback />);

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
});
