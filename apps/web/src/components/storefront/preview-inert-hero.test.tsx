import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PreviewInertHero } from './preview-inert-hero';

describe('PreviewInertHero', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      }
    );
  });

  it('matches published padding and preserves bounded animation settings', () => {
    render(
      <PreviewInertHero
        animationDelay={1}
        animationDuration="slow"
        animationTrigger="onload"
        animationType="fade-in"
        padding="large"
        title="Animated hero"
      />
    );

    expect(screen.getByRole('region', { name: 'Preview hero' })).toHaveClass(
      'py-32'
    );
    expect(screen.getByRole('region', { name: 'Preview hero' })).toMatchObject({
      dataset: {
        animationDelay: '1',
        animationDuration: 'slow',
        animationTrigger: 'onload',
        animationType: 'fade-in',
      },
    });
  });

  it('renders image and gradient contrast as a separate overlay layer', () => {
    const { rerender } = render(
      <PreviewInertHero
        backgroundImage="/hero.webp"
        overlay
        title="Image hero"
      />
    );

    expect(screen.getByTestId('builder-preview-hero-overlay')).toHaveClass(
      'bg-store-foreground/40'
    );
    expect(
      screen.getByTestId('builder-preview-hero-overlay').className
    ).not.toMatch(/\bbg-black\//);

    rerender(
      <PreviewInertHero
        backgroundGradient="linear-gradient(#000000, #ffffff)"
        title="Gradient hero"
      />
    );
    expect(screen.getByTestId('builder-preview-hero-overlay')).toHaveClass(
      'bg-store-foreground/60'
    );
  });

  it('renders CTA text as an inert themed large button', () => {
    render(<PreviewInertHero ctaText="Shop collection" title="Store hero" />);

    const cta = screen.getByRole('button', { name: 'Shop collection' });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-disabled', 'true');
    expect(cta).toHaveClass(
      'inline-flex',
      'h-12',
      'min-w-[48px]',
      'rounded-md',
      'bg-store-primary',
      'text-store-primary-text',
      'text-sm',
      'font-medium'
    );
  });

  it('shows a bounded inert destination for ctaLink-only edits', () => {
    render(
      <PreviewInertHero
        ctaLink="/collections/new-arrivals"
        title="Store hero"
      />
    );

    const destination = screen.getByRole('status', {
      name: 'Preview CTA destination',
    });
    expect(destination).toHaveTextContent('/collections/new-arrivals');
    expect(destination).toHaveClass('max-w-full', 'truncate');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
