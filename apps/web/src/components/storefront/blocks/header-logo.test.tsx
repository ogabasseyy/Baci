import { render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'>) => (
    // biome-ignore lint/performance/noImgElement: test double
    <img {...props} alt={props.alt ?? ''} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { HeaderLogo } from './header-logo';

describe('HeaderLogo', () => {
  const getHref = (path: string) => `/test-merchant${path}`;

  it('renders the linked logo image with the store name', () => {
    render(
      <HeaderLogo
        getHref={getHref}
        layout="logo-left-nav-right"
        logoUrl="https://cdn.example/logo.png"
        storeName="Test Store"
      />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/test-merchant/');
    expect(screen.getByAltText('Test Store')).toHaveAttribute(
      'src',
      expect.stringContaining('logo.png')
    );
    expect(screen.getByText('Test Store')).toBeInTheDocument();
  });

  it('falls back to the brand mark without a logo url', () => {
    const { container } = render(
      <HeaderLogo
        getHref={getHref}
        layout="logo-left-nav-right"
        logoUrl={undefined}
        storeName="Test Store"
      />
    );

    expect(
      screen.queryByRole('img', { name: 'Test Store' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Test Store')).toBeInTheDocument();
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
  });

  it('centers the lockup for the centered layout', () => {
    const { container } = render(
      <HeaderLogo
        getHref={getHref}
        layout="logo-center"
        logoUrl={undefined}
        storeName="Test Store"
      />
    );

    expect(container.firstElementChild?.className).toContain('mx-auto');
  });
});
