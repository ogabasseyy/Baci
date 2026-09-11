import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepairsLabHeroActionSlot } from './repairs-lab-hero-action-slot';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

describe('RepairsLabHeroActionSlot', () => {
  it('renders a storefront link when an href is provided', () => {
    render(
      <RepairsLabHeroActionSlot
        className="slot"
        href="/repair"
        label="Book a Repair"
      />
    );

    expect(screen.getByRole('link', { name: 'Book a Repair' })).toHaveAttribute(
      'href',
      '/repair'
    );
  });

  it('renders an inert placeholder when the href is missing', () => {
    render(
      <RepairsLabHeroActionSlot className="slot" label="Book a Repair" />
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Book a Repair')).toHaveClass('invisible');
    expect(screen.getByText('Book a Repair')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});
