import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Client-navigation simulation only (next/dynamic's CJS runtime binds Next's internal
// react copy under Vitest); real 404 SSR inline-<style> output was verified via `next build`.
vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<{ default: ComponentType }>,
    options?: { loading?: () => ReactNode }
  ) => {
    const LazyComponent = lazy(loader);
    const LoadingFallback = options?.loading;
    return function DynamicNotFound(props: Record<string, unknown>) {
      return (
        <Suspense fallback={LoadingFallback ? <LoadingFallback /> : null}>
          <LazyComponent {...props} />
        </Suspense>
      );
    };
  },
}));

import NotFound from './not-found';
import NotFoundContent from './not-found-content';

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
  it('renders a non-blank fallback while the client 404 chunk resolves on client navigation', async () => {
    render(<NotFound />);

    expect(
      screen.getByRole('heading', { name: /page not found/i })
    ).toBeInTheDocument();
    expect(await screen.findByText('404')).toBeInTheDocument();
  });

  it('keeps the root not-found shell styled without relying on a CSS module chunk', () => {
    const html = renderToString(<NotFoundContent />);
    expect(html).toContain('<style>');
    expect(html).toContain('.baci-system-error-page');

    const { container } = render(<NotFoundContent />);

    expect(screen.getByRole('main')).toHaveClass('baci-system-error-page');
    const stylesheet = container.querySelector('style')?.textContent ?? '';
    expect(stylesheet).toContain('@media (max-width: 520px)');
    expect(stylesheet).toContain('@media (prefers-color-scheme: dark)');
    expect(stylesheet).toContain('.baci-system-error-button:hover');
    expect(stylesheet).toContain('rgba(79,70,229,0.08)');
    expect(stylesheet).toContain('display:flex');
    expect(stylesheet).not.toContain('\n');
    expect(stylesheet).not.toContain(';}');
  });

  it('renders the 404 status and page heading', () => {
    render(<NotFoundContent />);

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /page not found/i,
      })
    ).toBeInTheDocument();
  });

  it('renders the Baci logo', () => {
    render(<NotFoundContent />);

    expect(screen.getByText('Baci')).toBeInTheDocument();
  });

  it('links back to the homepage', () => {
    render(<NotFoundContent />);

    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('links to contact support', () => {
    render(<NotFoundContent />);

    expect(
      screen.getByRole('link', { name: /contact support/i })
    ).toHaveAttribute('href', '/contact');
  });

  it('exposes the labelled section as a region', () => {
    render(<NotFoundContent />);

    expect(
      screen.getByRole('region', { name: /page not found/i })
    ).toBeInTheDocument();
  });
});
