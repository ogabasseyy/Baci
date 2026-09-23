import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/notifications/notification-center', () => ({
  NotificationCenter: () => null,
}));

import { getCountryByCode } from '@/lib/countries';
import { DashboardHeaderActions } from './dashboard-header-actions';

function setup(
  overrides: Partial<React.ComponentProps<typeof DashboardHeaderActions>> = {}
) {
  const onSelectCountry = vi.fn();
  const onSignOut = vi.fn();
  render(
    <DashboardHeaderActions
      merchantLoading={false}
      storeUrl="https://acme.usebaci.com"
      selectedCountry={getCountryByCode('NG') ?? null}
      onSelectCountry={onSelectCountry}
      onSignOut={onSignOut}
      {...overrides}
    />
  );
  return { onSelectCountry, onSignOut };
}

describe('DashboardHeaderActions', () => {
  it('renders the store link and selected country flag', () => {
    setup();

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://acme.usebaci.com'
    );
    expect(
      screen.getByRole('button', { name: 'Select country' })
    ).toBeInTheDocument();
  });

  it('shows a globe when no country is selected', () => {
    setup({ selectedCountry: null });

    expect(screen.getByText('🌐')).toBeInTheDocument();
  });

  it('selects a country from the menu', async () => {
    const user = userEvent.setup();
    const { onSelectCountry } = setup();

    await user.click(screen.getByRole('button', { name: 'Select country' }));
    await user.click(screen.getByRole('menuitem', { name: /Nigeria/ }));

    expect(onSelectCountry).toHaveBeenCalledWith('NG');
  });

  it('navigates to settings from the user menu', async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    setup();

    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(pushMock).toHaveBeenCalledWith('/dashboard/settings');
  });

  it('signs out from the user menu', async () => {
    const user = userEvent.setup();
    const { onSignOut } = setup();

    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
