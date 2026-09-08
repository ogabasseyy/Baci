import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepairsLabHero } from './repairs-lab-hero';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

describe('RepairsLabHero', () => {
  it('paints the Repair Lab heading and landfill LCP paragraph', () => {
    render(
      <RepairsLabHero repairHref="/repair" swapHref="/swap" />
    );

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/every device repaired is one less in a landfill/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /book a repair/i })).toHaveAttribute(
      'href',
      '/repair'
    );
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/swap');
  });

  it('can paint the LCP copy without Next.js links in a loading shell', () => {
    render(<RepairsLabHero />);

    expect(screen.getByText(/every device repaired is one less in a landfill/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // Inert placeholders occupy the same flex slots as the eventual links.
    for (const label of ['Book a Repair', 'Trade-in Instead']) {
      expect(screen.getByText(label)).toHaveClass('invisible');
      expect(screen.getByText(label)).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
