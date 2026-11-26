import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const LazyComponent = lazy(loader);
    return function DynamicNotFound(props: Record<string, unknown>) {
      return (
        <Suspense fallback={null}>
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
  it('lazy-loads the 404 UI from the root client boundary while keeping SSR inline styling', async () => {
    const html = renderToString(<NotFoundContent />);
    expect(html).toContain('<style>');
    expect(html).toContain('.baci-system-error-page');
    expect(html).toContain('Page not found');

    render(<NotFound />);
    expect(
      await screen.findByRole('heading', { name: /page not found/i })
    ).toBeInTheDocument();
  });

  it('keeps the root not-found shell styled without relying on a CSS module chunk', () => {
    const { container } = render(<NotFoundContent />);

    expect(screen.getByRole('main')).toHaveClass('baci-system-error-page');
    const stylesheet = container.querySelector('style')?.textContent ?? '';
    expect(stylesheet).toContain('@media (max-width: 520px)');
    expect(stylesheet).toContain('@media (prefers-color-scheme: dark)');
    expect(stylesheet).toContain('.baci-system-error-button:hover');
    expect(stylesheet).not.toContain('\n');
    expect(stylesheet).not.toContain(';}');
  });

  it('keeps NotFound as a dynamic client boundary without eagerly importing system CSS into 200 chunks or Flight', () => {
    const entrySource = readFileSync(
      resolve(__dirname, 'not-found.tsx'),
      'utf8'
    );
    expect(entrySource.trimStart().startsWith("'use client';")).toBe(true);
    expect(entrySource).toContain(
      "dynamic(() => import('./not-found-content')"
    );
    expect(entrySource).not.toContain('system-error-styles');
    expect(entrySource).not.toContain('ssr: false');

    const contentSource = readFileSync(
      resolve(__dirname, 'not-found-content.tsx'),
      'utf8'
    );
    expect(contentSource.trimStart().startsWith("'use client';")).toBe(true);
    expect(contentSource).toContain('systemErrorStyleSheet');
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
