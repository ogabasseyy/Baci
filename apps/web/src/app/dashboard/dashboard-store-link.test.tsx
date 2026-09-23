import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DashboardStoreLink } from './dashboard-store-link';

function setup(
  overrides: Partial<React.ComponentProps<typeof DashboardStoreLink>> = {}
) {
  render(
    <DashboardStoreLink
      isCollapsed={false}
      merchantLoading={false}
      storeUrl="https://acme.usebaci.com"
      {...overrides}
    />
  );
}

describe('DashboardStoreLink', () => {
  it('renders a loading state while the merchant loads', () => {
    setup({ merchantLoading: true });

    expect(screen.getByText('Visit Store')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a loading state for the unresolved placeholder', () => {
    setup({ storeUrl: '#' });

    expect(screen.getByText('Visit Store')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links trusted subdomain URLs and shows the hostname', () => {
    setup();

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://acme.usebaci.com');
    expect(screen.getByText('acme.usebaci.com')).toBeInTheDocument();
  });

  it('links relative development paths', () => {
    setup({ storeUrl: '/acme' });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/acme');
  });

  it('links custom domains matching the merchant domain', () => {
    setup({
      storeUrl: 'https://shop.acme.com',
      customDomain: 'shop.acme.com',
    });

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://shop.acme.com'
    );
  });

  it('falls back to the dashboard root for untrusted URLs', () => {
    setup({ storeUrl: 'https://evil.example.com/acme' });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });
});
