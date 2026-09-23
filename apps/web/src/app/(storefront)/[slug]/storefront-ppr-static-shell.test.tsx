import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOREFRONT_APPEARANCE } from '@/components/storefront/storefront-appearance';
import { StorefrontPprStaticShell } from './storefront-ppr-static-shell';

describe('StorefrontPprStaticShell', () => {
  it('marks the first-paint storefront shell and hides a sibling fallback', () => {
    const { container } = render(
      <StorefrontPprStaticShell
        appearance={DEFAULT_STOREFRONT_APPEARANCE}
        loadingFallback={<div>Loading storefront chrome</div>}
      >
        <main>Route content</main>
      </StorefrontPprStaticShell>
    );

    expect(container.querySelector('[data-storefront-shell]')).toHaveClass(
      'storefront-ppr-static-shell'
    );
    expect(screen.getByRole('main')).toHaveTextContent('Route content');
    expect(
      container.querySelector('.storefront-ppr-static-shell__fallback')
    ).toHaveTextContent('Loading storefront chrome');
  });

  it('omits the visual fallback slot when none is provided', () => {
    const { container } = render(
      <StorefrontPprStaticShell
        appearance={DEFAULT_STOREFRONT_APPEARANCE}
        loadingFallback={null}
      >
        <main>No fallback</main>
      </StorefrontPprStaticShell>
    );

    expect(
      container.querySelector('.storefront-ppr-static-shell__fallback')
    ).not.toBeInTheDocument();
  });
});
