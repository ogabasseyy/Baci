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

it('keeps the footer below the viewport while a streamed route temporarily has no content', () => {
  render(
    <StorefrontShellLayout footerChrome={<footer>Footer</footer>}>
      {null}
    </StorefrontShellLayout>
  );
  expect(screen.getByRole('main')).toHaveClass('ogabassey-storefront-main');
  expect(screen.getByRole('main')).not.toHaveStyle({ minHeight: '100svh' });
});
