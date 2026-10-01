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
  it('paints the Repair Lab heading and a visible short supporting line', () => {
    render(
      <RepairsLabHero repairHref="/repair" swapHref="/swap" />
    );

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/extend the life of your devices/i)
    ).not.toHaveClass('sr-only');
    expect(
      screen.getByText(/certified technicians use genuine parts/i)
    ).not.toHaveClass('sr-only');
    const support = document.querySelector('[data-cwv-lcp-support]');
    expect(support).toHaveTextContent(
      'Every device repaired is one less in a landfill.'
    );
    expect(support?.textContent).not.toMatch(/certified technicians/i);
    expect(support?.textContent).not.toMatch(/extend the life/i);
    const fold = document.querySelector('[data-cwv-lcp-fold]');
    expect(fold).toBeInTheDocument();
    expect(fold?.textContent).not.toMatch(/extend the life/i);
    expect(fold?.textContent).not.toMatch(/certified technicians/i);
    expect(
      document.querySelector('[data-cwv-lcp-copy="repairs"]')
    ).toHaveTextContent(/Don't Ditch It/);
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
