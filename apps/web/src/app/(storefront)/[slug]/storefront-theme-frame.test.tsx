import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STOREFRONT_APPEARANCE } from '@/components/storefront/storefront-appearance';
import { StorefrontThemeFrame } from './storefront-theme-frame';

vi.mock('@/components/storefront/storefront-theme-provider', () => ({
  StorefrontThemeProvider: ({
    appearance,
    children,
    scopeDocument,
  }: {
    appearance: unknown;
    children: ReactNode;
    scopeDocument?: boolean;
  }) => (
    <div
      data-appearance={String(appearance)}
      data-scope-document={String(scopeDocument)}
      data-testid="theme-provider"
    >
      {children}
    </div>
  ),
}));

describe('StorefrontThemeFrame', () => {
  it('forwards appearance and scopes the document by default', () => {
    render(
      <StorefrontThemeFrame appearance={DEFAULT_STOREFRONT_APPEARANCE}>
        <main>Themed</main>
      </StorefrontThemeFrame>
    );

    expect(screen.getByTestId('theme-provider')).toHaveAttribute(
      'data-scope-document',
      'true'
    );
    expect(screen.getByRole('main')).toHaveTextContent('Themed');
  });

  it('can opt out of document scoping', () => {
    render(
      <StorefrontThemeFrame
        appearance={DEFAULT_STOREFRONT_APPEARANCE}
        scopeDocument={false}
      >
        <main>Nested</main>
      </StorefrontThemeFrame>
    );

    expect(screen.getByTestId('theme-provider')).toHaveAttribute(
      'data-scope-document',
      'false'
    );
  });
});
