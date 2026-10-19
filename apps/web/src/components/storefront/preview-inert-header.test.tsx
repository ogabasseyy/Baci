import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewInertHeader } from './preview-inert-header';

describe('PreviewInertHeader', () => {
  it('visibly reflects supported controls, layout, and sticky state with inert UI', () => {
    const { rerender } = render(
      <PreviewInertHeader
        layout="logo-center"
        navigationLinks={[{ label: 'Shop', url: '/products' }]}
        showCart
        showMenu
        showSearch
        sticky
        storeName="Preview Store"
      />
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-layout', 'logo-center');
    expect(header).toHaveAttribute('data-sticky', 'true');
    expect(header).toHaveClass('fixed', 'grid', 'z-50');
    expect(header).not.toHaveClass('z-0');
    expect(
      screen.getByRole('navigation', { name: 'Preview navigation' })
    ).toHaveClass('hidden', 'md:flex');
    expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Account' })).toHaveClass(
      'hidden',
      'sm:inline-flex'
    );
    expect(screen.getByRole('button', { name: 'Cart' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeDisabled();

    rerender(
      <PreviewInertHeader
        layout="logo-left-nav-right"
        showAccount={false}
        showCart={false}
        showMenu={false}
        showSearch={false}
      />
    );

    expect(header).toHaveAttribute('data-layout', 'logo-left-nav-right');
    expect(header).toHaveAttribute('data-sticky', 'false');
    expect(header).toHaveClass('flex');
    expect(header).toHaveClass('relative');
    expect(header).not.toHaveClass('fixed');
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cart' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
  });

  it('hides saved navigation links when the production menu control is disabled', () => {
    render(
      <PreviewInertHeader
        navigationLinks={[{ label: 'Shop', url: '/products' }]}
        showMenu={false}
      />
    );

    expect(
      screen.queryByRole('navigation', { name: 'Preview navigation' })
    ).toBeNull();
  });

  it('shows accepted navigation labels in an inert mobile disclosure', () => {
    render(
      <PreviewInertHeader
        navigationLinks={[
          { label: 'Shop', url: '/products' },
          { label: 'About', url: '/about' },
        ]}
        showMenu
      />
    );

    const mobileNavigation = screen.getByRole('navigation', {
      name: 'Preview mobile navigation',
    });
    expect(mobileNavigation).toHaveClass('md:hidden');
    expect(mobileNavigation).toHaveTextContent('Shop');
    expect(mobileNavigation).toHaveTextContent('About');
    expect(screen.getAllByText('/products')).toHaveLength(2);
    expect(screen.getAllByText('/about')).toHaveLength(2);
    expect(mobileNavigation.querySelectorAll('a')).toHaveLength(0);
  });

  it('uses published Header action defaults while retaining explicit disabled controls', () => {
    const { rerender } = render(<PreviewInertHeader />);

    expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Cart' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeDisabled();

    rerender(
      <PreviewInertHeader
        showCart={false}
        showMenu={false}
        showSearch={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cart' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
  });

  it('renders every supported search style, radius, glass, and padding control', () => {
    render(
      <PreviewInertHeader
        glassEffect
        paddingY="lg"
        searchRadius="full"
        searchStyle="filled"
        showSearch
      />
    );

    const header = screen.getByRole('banner');
    const desktopSearch = screen
      .getAllByRole('button', { name: 'Search' })
      .find((button) => button.classList.contains('md:inline-flex'));
    expect(header).toHaveAttribute('data-glass-effect', 'true');
    expect(header).toHaveClass('py-6');
    expect(header).not.toHaveClass('backdrop-blur-md');
    expect(header).toHaveClass('text-store-primary-text');
    expect(desktopSearch).toHaveAttribute('data-search-style', 'filled');
    expect(desktopSearch).toHaveAttribute('data-search-radius', 'full');
    expect(desktopSearch).toHaveClass('bg-muted', 'rounded-full');
    expect(desktopSearch).toBeDisabled();
  });

  it('applies persisted storefront header colors', () => {
    render(
      <PreviewInertHeader backgroundColor="#123456" textColor="#fefefe" />
    );

    expect(screen.getByRole('banner')).toHaveStyle({
      backgroundColor: '#123456',
      color: '#fefefe',
    });
  });

  it('renders a retained local background image as an inert pattern', () => {
    render(<PreviewInertHeader backgroundImage="/media/header.webp" />);

    expect(screen.getByTestId('builder-preview-header-background')).toHaveStyle(
      { backgroundImage: 'url(/media/header.webp)' }
    );
  });

  it('renders a retained local logo when logos are enabled', () => {
    render(
      <PreviewInertHeader logoUrl="/media/logo.png" storeName="Acme Store" />
    );

    expect(
      screen.getByRole('img', { name: 'Acme Store logo' })
    ).toHaveAttribute('src', '/media/logo.png');
    expect(screen.getByText('Acme Store')).toBeInTheDocument();
  });

  it('uses a merchant identity mark when the Header has no saved logo source', () => {
    render(<PreviewInertHeader storeName="Acme Store" />);

    expect(screen.getByLabelText('Acme Store preview logo')).toHaveTextContent(
      'A'
    );
    expect(screen.getByText('Acme Store')).toBeInTheDocument();
  });

  it('keeps the published mobile CTA breakpoint in the inert preview', () => {
    render(
      <PreviewInertHeader
        ctaButton={{ show: true, text: 'Shop now', url: '/collections/new' }}
      />
    );

    expect(screen.getByRole('button', { name: 'Shop now' })).toHaveClass(
      'hidden',
      'sm:inline-flex'
    );
    expect(screen.getByText('/collections/new')).toBeInTheDocument();
    expect(screen.getByText('Shop now /collections/new')).toHaveClass(
      'sm:hidden'
    );
    expect(screen.queryByRole('link', { name: 'Shop now' })).toBeNull();
  });

  it('renders an icon-only mobile search action alongside the desktop search control', () => {
    render(
      <PreviewInertHeader searchRadius="full" searchStyle="filled" showSearch />
    );

    const searches = screen.getAllByRole('button', { name: 'Search' });
    const mobileSearch = searches.find((button) =>
      button.classList.contains('md:hidden')
    );
    const desktopSearch = searches.find((button) =>
      button.classList.contains('md:inline-flex')
    );

    expect(mobileSearch).toHaveClass('md:hidden');
    expect(mobileSearch).not.toHaveTextContent('Search');
    expect(mobileSearch).toBeDisabled();
    expect(desktopSearch).toHaveClass('hidden', 'md:inline-flex');
    expect(desktopSearch).toHaveTextContent('Search...');
    expect(desktopSearch).toHaveClass('bg-muted', 'rounded-full');
  });

  it('uses themed glass contrast at the top and mirrors the published glass state after scrolling', () => {
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
      writable: true,
    });

    render(<PreviewInertHeader glassEffect sticky textColor="#123456" />);

    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-scroll-state', 'top');
    expect(header).toHaveClass('text-store-primary-text');
    expect(header).not.toHaveClass('backdrop-blur-md', 'shadow-sm');

    window.scrollY = 51;
    fireEvent.scroll(window);

    expect(header).toHaveAttribute('data-scroll-state', 'scrolled');
    expect(header).toHaveClass(
      'backdrop-blur-md',
      'bg-store-background/80',
      'shadow-sm'
    );
    expect(header).not.toHaveStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
    });
    expect(header).toHaveStyle({ color: '#123456' });
  });
});
