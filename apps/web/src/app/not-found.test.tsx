import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import NotFound from './not-found';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('NotFound', () => {
  it('renders the 404 status and page heading', () => {
    render(<NotFound />);

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /page not found/i,
      })
    ).toBeInTheDocument();
  });

  it('keeps the root not-found shell styled without relying on a CSS module chunk', () => {
    const { container } = render(<NotFound />);

    expect(screen.getByRole('main')).toHaveClass('baci-system-error-page');
    const stylesheet = container.querySelector('style')?.textContent ?? '';
    expect(stylesheet).toContain('@media (max-width: 520px)');
    expect(stylesheet).toContain('.baci-system-error-button:hover');
    expect(stylesheet).not.toContain('\n');
  });

  it('renders the Baci logo', () => {
    render(<NotFound />);

    expect(screen.getByText('Baci')).toBeInTheDocument();
  });

  it('links back to the homepage', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('links to contact support', () => {
    render(<NotFound />);

    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/contact');
  });

  it('exposes the labelled section as a region', () => {
    render(<NotFound />);

    expect(
      screen.getByRole('region', { name: /page not found/i })
    ).toBeInTheDocument();
  });
});
