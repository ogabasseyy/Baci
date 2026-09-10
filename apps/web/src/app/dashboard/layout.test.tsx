import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import DashboardLayout from './layout';

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-sans-font">{children}</div>
  ),
}));

vi.mock('@/components/passkey-enrollment-prompt', () => ({
  PasskeyEnrollmentPrompt: () => <div data-testid="passkey-prompt" />,
}));

vi.mock('./auth-guard', () => ({
  DashboardAuthGuard: ({ children }: { children: ReactNode }) => (
    <div data-testid="dashboard-auth-guard">{children}</div>
  ),
}));

vi.mock('./loading', () => ({
  default: () => <div data-testid="dashboard-loading" />,
}));

describe('DashboardLayout', () => {
  it('keeps Inter on dashboard routes without going through the storefront document CSS', () => {
    render(
      <DashboardLayout>
        <main>Dashboard</main>
      </DashboardLayout>
    );

    expect(screen.getByTestId('app-sans-font')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-auth-guard')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Dashboard');
  });
});
