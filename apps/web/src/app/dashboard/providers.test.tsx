import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from './providers';

const appBodyMock = vi.fn(({ children }: { children: React.ReactNode }) => (
  <div data-testid="app-body">{children}</div>
));
const authProviderMock = vi.fn(
  ({ children }: { children: React.ReactNode; initialUser?: unknown }) => (
    <section aria-label="Auth Provider" data-testid="auth-provider">
      {children}
    </section>
  )
);

interface NonceProviderState {
  nonce?: string;
}

const nonceProviderState: NonceProviderState = {};

vi.mock('@/contexts/auth-context', () => ({
  AuthProvider: (props: { children: React.ReactNode; initialUser?: unknown }) =>
    authProviderMock(props),
}));

vi.mock('next-themes', () => ({
  ThemeProvider: ({
    children,
    nonce,
  }: {
    children: React.ReactNode;
    nonce?: string;
  }) => (
    <section aria-label="Theme Provider" data-nonce={nonce}>
      {children}
    </section>
  ),
}));

vi.mock('@/contexts/NonceProvider', () => ({
  NonceProvider: ({
    children,
    nonce,
  }: {
    children: React.ReactNode;
    nonce?: string;
  }) => {
    nonceProviderState.nonce = nonce;
    return (
      <section aria-label="Nonce Provider" data-nonce={nonce}>
        {children}
      </section>
    );
  },
  useNonce: () => ({ nonce: nonceProviderState.nonce }),
}));

vi.mock('@/contexts/MotionNonceProvider', () => ({
  MotionNonceProvider: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Motion Nonce Provider">{children}</section>
  ),
}));

vi.mock('@/components/csrf-initializer', () => ({
  CsrfInitializer: () => <div data-testid="csrf-initializer" />,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Merchant Provider">{children}</section>
  ),
  useMerchant: () => ({ merchant: null }),
}));

vi.mock('@/contexts/product-context', () => ({
  ProductProvider: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Product Provider">{children}</section>
  ),
}));

vi.mock('@/components/dashboard/upgrade-modal', () => ({
  UpgradeModalProvider: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Upgrade Modal Provider">{children}</section>
  ),
}));

vi.mock('@/hooks/notifications-provider', () => ({
  NotificationsProvider: ({ children }: { children: React.ReactNode }) => (
    <section aria-label="Notifications Provider">{children}</section>
  ),
}));

vi.mock('./client-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="client-layout">{children}</div>
  ),
}));

vi.mock('@/components/app-body', () => ({
  default: (props: { children: React.ReactNode }) => appBodyMock(props),
}));

describe('DashboardProviders', () => {
  beforeEach(() => {
    appBodyMock.mockClear();
    nonceProviderState.nonce = undefined;
    authProviderMock.mockClear();
  });

  it('renders children within provider tree', () => {
    render(
      <DashboardProviders>
        <div data-testid="child-content">Dashboard Content</div>
      </DashboardProviders>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
  });

  it('wraps children in NonceProvider', () => {
    render(
      <DashboardProviders nonce="nonce-123">
        <div>Content</div>
      </DashboardProviders>
    );

    const nonceProvider = screen.getByRole('region', {
      name: 'Nonce Provider',
    });
    expect(nonceProvider).toHaveAttribute('data-nonce', 'nonce-123');
    expect(nonceProvider).toContainElement(
      screen.getByRole('region', { name: 'Auth Provider' })
    );
    expect(nonceProvider).toContainElement(screen.getByText('Content'));
  });

  it('forwards the nonce to ThemeProvider', () => {
    render(
      <DashboardProviders nonce="nonce-123">
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Theme Provider' })
    ).toHaveAttribute('data-nonce', 'nonce-123');
  });

  it('mounts CsrfInitializer for CSRF token initialization', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(screen.getByTestId('csrf-initializer')).toBeInTheDocument();
  });

  it('wraps children in AuthProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Auth Provider' })
    ).toBeInTheDocument();
  });

  it('passes the server-authenticated user into AuthProvider', () => {
    const initialUser = { id: 'user-1' };

    render(
      <DashboardProviders initialUser={initialUser as never}>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(authProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialUser })
    );
  });

  it('handles missing initialUser gracefully', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(authProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialUser: undefined })
    );
  });

  it('wraps children in ThemeProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Theme Provider' })
    ).toBeInTheDocument();
  });

  it('opts the dashboard route into Framer nonce support', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Motion Nonce Provider' })
    ).toBeInTheDocument();
  });

  it('wraps children in MerchantProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Merchant Provider' })
    ).toBeInTheDocument();
  });

  it('wraps children in ProductProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Product Provider' })
    ).toBeInTheDocument();
  });

  it('wraps children in NotificationsProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Notifications Provider' })
    ).toContainElement(
      screen.getByRole('region', { name: 'Upgrade Modal Provider' })
    );
  });

  it('wraps the dashboard shell in UpgradeModalProvider', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(
      screen.getByRole('region', { name: 'Upgrade Modal Provider' })
    ).toContainElement(screen.getByTestId('client-layout'));
  });

  it('disables storefront overlays inside the dashboard shell', () => {
    render(
      <DashboardProviders>
        <div>Content</div>
      </DashboardProviders>
    );

    expect(appBodyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        applyMerchantCoreThemeVariables: false,
        showCookieConsent: false,
        showNewsletterWidget: false,
      })
    );
  });
});
