import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import BuilderLayout from './layout';

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-sans-font">{children}</div>
  ),
}));

vi.mock('@/contexts/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

describe('BuilderLayout', () => {
  it('wraps builder routes in AuthProvider', () => {
    render(
      <BuilderLayout>
        <main>Builder content</main>
      </BuilderLayout>
    );

    expect(screen.getByTestId('app-sans-font')).toBeInTheDocument();
    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Builder content');
  });
});
