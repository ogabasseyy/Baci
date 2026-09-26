import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyDeletionPolicy } from './ogabassey-deletion-policy';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe('Ogabassey deletion policy', () => {
  it('explains the privacy and tax retention periods with the store policy link', () => {
    render(
      <OgabasseyDeletionPolicy privacyHref={'/ogabassey/privacy' as Route} />
    );

    expect(screen.getByText(/six calendar months/).closest('div')).toHaveClass(
      'bg-card',
      'text-card-foreground'
    );
    expect(
      screen.getByText(/six calendar months after a purpose ends/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/six years after the relevant year of assessment/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/ogabassey/privacy');
  });
});
