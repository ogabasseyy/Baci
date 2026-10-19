import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LabHeaderLogoFallback } from './lab-header-logo-fallback';

vi.mock('next/link', () => ({
  default: ({
    children,
    className,
    href,
  }: {
    children: React.ReactNode;
    className?: string;
    href: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

describe('LabHeaderLogoFallback', () => {
  it('renders the store name and applies layout ordering classes', () => {
    const leftHtml = renderToStaticMarkup(
      <LabHeaderLogoFallback
        getHref={(path) => `/store${path}`}
        layout="logo-left-nav-center"
        storeName="OgaBassey"
      />
    );
    expect(leftHtml).toContain('href="/store/"');
    expect(leftHtml).toContain('OgaBassey');
    expect(leftHtml).toContain('order-1');

    const centerHtml = renderToStaticMarkup(
      <LabHeaderLogoFallback
        getHref={(path) => path}
        layout="logo-center"
        storeName="Centered Store"
      />
    );
    expect(centerHtml).toContain('order-2 mx-auto');
    expect(centerHtml).toContain('Centered Store');
  });
});
