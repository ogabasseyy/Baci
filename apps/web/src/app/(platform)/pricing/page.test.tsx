import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PricingPage from './page';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/app-body', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/platform/header', () => ({ PlatformHeader: () => null }));
vi.mock('@/components/platform/footer', () => ({ PlatformFooter: () => null }));

describe('public pricing page claims', () => {
  it('does not present unverified API or wholesale access as included', () => {
    render(<PricingPage />);

    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.queryByText('API Access')).not.toBeInTheDocument();
    expect(screen.queryByText('Wholesale Features')).not.toBeInTheDocument();
  });
});
