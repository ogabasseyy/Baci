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
    const { container } = render(<PricingPage />);

    expect(screen.getByText('Premium')).toBeInTheDocument();
    const text = container.textContent?.toLowerCase() ?? '';
    expect(text).not.toContain('api access');
    expect(text).not.toContain('wholesale features');
  });
});
