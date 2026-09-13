import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { StorefrontShellLayout } from './storefront-shell-layout';

vi.mock('./storefront-layout-providers', () => ({
  OgabasseyLayoutProviders: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./storefront-layout-utils', () => ({
  getOgabasseyLayoutStyle: () => ({}),
}));

it('reserves main space before streamed children arrive on every viewport', () => {
  render(<StorefrontShellLayout footerChrome={<footer>Footer</footer>}>{null}</StorefrontShellLayout>);
  expect(screen.getByRole('main')).toHaveStyle({ minHeight: '100svh' });
});
