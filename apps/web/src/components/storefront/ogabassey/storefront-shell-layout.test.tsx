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

it('lets the flex shell reserve the viewport below the streamed header', () => {
  render(<StorefrontShellLayout footerChrome={<footer>Footer</footer>}>{null}</StorefrontShellLayout>);
  expect(screen.getByRole('main')).toHaveClass('ogabassey-storefront-main');
  expect(screen.getByRole('main')).not.toHaveStyle({ minHeight: '100svh' });
});
