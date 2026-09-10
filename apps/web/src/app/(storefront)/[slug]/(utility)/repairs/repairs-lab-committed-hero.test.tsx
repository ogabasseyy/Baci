import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepairsLabCommittedHero } from './repairs-lab-committed-hero';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

describe('RepairsLabCommittedHero', () => {
  it('paints branded lab copy for the monitored tenant without a merchant lookup', async () => {
    render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Don't Ditch It/i)).toBeInTheDocument();
  });

  it('keeps repair and trade-in actions as links on the slug-prefixed route', async () => {
    render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/ogabassey/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/ogabassey/swap');
  });

  it('keeps repair and trade-in actions as links on the custom-domain route', async () => {
    render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(
      screen.getByRole('link', { name: /book a repair/i })
    ).toHaveAttribute('href', '/repair');
    expect(
      screen.getByRole('link', { name: /trade-in instead/i })
    ).toHaveAttribute('href', '/swap');
  });

  it('omits branded lab copy for other merchants', async () => {
    const { container } = render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'other-store' }),
      })
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('heading', { name: 'Repair Lab' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /book a repair/i })
    ).not.toBeInTheDocument();
  });
});
