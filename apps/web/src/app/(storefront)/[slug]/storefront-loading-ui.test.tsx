import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BlogListingRouteLoading,
  BlogPostRouteLoading,
  CatalogListingLoading,
  CommerceRouteLoading,
  ContentRouteLoading,
  CustomerRouteLoading,
  HomeRouteLoading,
  ProductDetailRouteLoading,
  ShellChromeLoading,
  UtilityRouteLoading,
} from './storefront-loading-ui';

describe('storefront-loading-ui', () => {
  it('renders the shell chrome loading fallback', () => {
    const { container } = render(<ShellChromeLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading storefront chrome' })
    ).toBeInTheDocument();
    expect(
      container.querySelector('.storefront-shell-loading')
    ).toBeInTheDocument();
    expect(
      container.querySelector('.storefront-shell-loading__bar')
    ).toBeInTheDocument();
  });

  it('paints the provided mobile hero banner in the static shell slot', () => {
    const { container } = render(
      <ShellChromeLoading
        mobileHero={<div data-testid="tenant-hero">Banner</div>}
      />
    );

    const hero = container.querySelector(
      '.storefront-shell-loading__mobile-hero'
    );
    expect(hero).toBeInTheDocument();
    // Mobile-only and decorative: hidden from assistive tech because the real
    // streamed hero owns the accessible banner.
    expect(hero).toHaveAttribute('aria-hidden', 'true');
    expect(hero?.className).toContain('md:hidden');
    expect(hero?.querySelector('[data-testid="tenant-hero"]')).toBeTruthy();
  });

  it('can suppress the loading bar when a route owns exact fallback geometry', () => {
    const { container } = render(<ShellChromeLoading showLoadingBar={false} />);

    expect(
      container.querySelector('.storefront-shell-loading__bar')
    ).not.toBeInTheDocument();
  });

  it('does not reserve the mobile hero area when no banner is provided', () => {
    const { container } = render(<ShellChromeLoading />);

    expect(
      container.querySelector('.storefront-shell-loading__mobile-hero')
    ).not.toBeInTheDocument();
  });

  it('renders a lightweight storefront chrome frame before the hero slot', () => {
    const { container } = render(
      <ShellChromeLoading
        showChromeFrame
        mobileHero={<div data-testid="tenant-hero">Banner</div>}
      />
    );

    const chromeFrame = container.querySelector(
      '.storefront-shell-loading__chrome'
    );
    const hero = container.querySelector(
      '.storefront-shell-loading__mobile-hero'
    );

    expect(chromeFrame).toBeInTheDocument();
    expect(chromeFrame).toHaveAttribute('aria-hidden', 'true');
    expect(hero).toBeInTheDocument();
    expect(hero?.previousElementSibling).toBe(chromeFrame);
  });

  it('does not render the storefront chrome frame by default', () => {
    const { container } = render(
      <ShellChromeLoading
        mobileHero={<div data-testid="tenant-hero">Banner</div>}
      />
    );

    expect(
      container.querySelector('.storefront-shell-loading__chrome')
    ).not.toBeInTheDocument();
  });

  it('never emits its own preload link from the loading shell', () => {
    const html = renderToString(
      <ShellChromeLoading
        showChromeFrame
        mobileHero={<div data-testid="tenant-hero">Banner</div>}
      />
    );
    const template = document.createElement('template');
    template.innerHTML = html;

    expect(template.content.querySelector('link[rel="preload"]')).toBeNull();
  });

  it('does not rely on external CSS for critical shell fallback geometry', () => {
    const { container } = render(
      <ShellChromeLoading
        mobileHero={<div data-testid="tenant-hero">Banner</div>}
      />
    );

    const shell = container.querySelector('.storefront-shell-loading');
    const bar = container.querySelector('.storefront-shell-loading__bar');

    expect(shell).toHaveStyle({
      background: 'var(--storefront-shell-background, #0f0f0f)',
      color: 'var(--ogabassey-shell-text, #ffffff)',
      boxSizing: 'border-box',
      padding: '0.75rem 1rem',
    });
    expect(bar).toHaveStyle({
      height: '2.5rem',
    });
  });

  it('renders the shared route loading primitives', () => {
    render(
      <>
        <HomeRouteLoading />
        <CatalogListingLoading />
        <ProductDetailRouteLoading />
        <BlogListingRouteLoading />
        <BlogPostRouteLoading />
        <ContentRouteLoading />
        <CommerceRouteLoading />
        <CustomerRouteLoading />
        <UtilityRouteLoading />
      </>
    );

    expect(
      screen.getByRole('status', { name: 'Loading storefront homepage' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading product page' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading blog post' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading page content' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading commerce page' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading customer page' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading utility page' })
    ).toBeInTheDocument();
  });
});
