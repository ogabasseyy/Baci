import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AuthLayout from './layout';

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-sans-font">{children}</div>
  ),
}));

describe('AuthLayout', () => {
  it('keeps Inter on auth routes without going through the storefront document CSS', () => {
    render(
      <AuthLayout>
        <main>Sign in</main>
      </AuthLayout>
    );

    expect(screen.getByTestId('app-sans-font')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Sign in');
  });
});
