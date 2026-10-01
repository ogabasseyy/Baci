import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PlatformLayout from './layout';

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-sans-font">{children}</div>
  ),
}));

describe('PlatformLayout', () => {
  it('keeps Inter on platform routes without going through the storefront document CSS', () => {
    render(
      <PlatformLayout>
        <main>Platform</main>
      </PlatformLayout>
    );

    expect(screen.getByTestId('app-sans-font')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Platform');
  });
});
