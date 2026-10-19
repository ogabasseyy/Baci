import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrders: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    // biome-ignore lint/performance/noImgElement: Test mock for next/image intentionally uses <img>
    <img {...props} alt={props.alt as string} />
  ),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn(() => ({
    merchant: { id: 'm-1', slug: 'test', currency: 'NGN' },
    loading: false,
    hasPermission: vi.fn(() => true),
  })),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// The client page imports many subcomponents - mock them all
vi.mock('@/components/ui/bag-loader', () => ({
  BagLoader: () => <div>Loading...</div>,
}));

// Mock AuthContext to provide the required context
vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'user-1', email: 'test@example.com' },
    loading: false,
    signOut: vi.fn(),
  })),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./actions', () => ({
  getOrders: (...args: unknown[]) => mocks.getOrders(...args),
}));

import { useSearchParams } from 'next/navigation';
import OrdersClientPage from './client-page';

describe('OrdersClientPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getOrders.mockReset();
    mocks.getOrders.mockResolvedValue([]);
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ integrations: [] }),
    } as Response);
  });

  it('renders the orders header', () => {
    render(<OrdersClientPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Orders 📦' })
    ).toBeInTheDocument();
  });

  it('renders order cards with initial data', () => {
    render(
      <OrdersClientPage
        initialOrders={[
          {
            id: 'order-1',
            orderNumber: 'ORD-001',
            customerName: 'Chidimma Azubuike',
            total: 803638,
            currency: 'NGN',
            shippingStatus: 'Pending',
            paymentStatus: 'Pending',
            paymentMethod: 'card',
            date: 'Mar 18, 2026',
            createdAt: Date.now(),
            source: 'online_store',
            items: [
              {
                id: 'item-1',
                name: 'iPhone 14 Pro',
                quantity: 1,
                price: 803638,
              },
            ],
          },
        ]}
      />
    );

    // Order card expand/collapse behavior is tested in order-card.test.tsx
    expect(screen.getByText('1 item: iPhone 14 Pro')).toBeInTheDocument();
  });

  it('shows the server-provided orders error instead of empty state', () => {
    render(<OrdersClientPage initialOrdersError="Could not load orders." />);

    expect(screen.getByText('Failed to Load Orders')).toBeInTheDocument();
    expect(screen.getByText(/Could not load orders\./i)).toBeInTheDocument();
  });

  it('renders an agentic issue banner when agentic_issue is present', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('agentic_issue=AGENTIC_PAYMENT_SETUP_FAILED') as never
    );

    render(<OrdersClientPage />);

    expect(screen.getByText('Agentic checkout focus')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Payment setup failed for one or more agentic checkouts.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear focus' })).toHaveAttribute(
      'href',
      '/dashboard/orders?source=agentic'
    );
  });

  it('adds a trust-controls shortcut for allowlist issues', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(
        'agentic_issue=AGENTIC_AGENT_ALLOWLIST_UNSET'
      ) as never
    );

    render(<OrdersClientPage />);

    expect(
      screen.getByRole('link', { name: 'Open trust controls' })
    ).toHaveAttribute(
      'href',
      '/dashboard/settings/trust#agent-checkout-controls'
    );
  });

  it('keeps the agentic source filter when loading orders', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('source=agentic') as never
    );

    render(<OrdersClientPage />);

    await waitFor(() => {
      expect(mocks.getOrders).toHaveBeenCalledWith(
        'm-1',
        expect.objectContaining({ source: 'agentic' })
      );
    });
  });

  it('threads the Jumia link scope into the order query', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('source=jumia&integrationId=int-1') as never
    );

    render(<OrdersClientPage />);

    await waitFor(() => {
      expect(mocks.getOrders).toHaveBeenCalledWith(
        'm-1',
        expect.objectContaining({
          source: 'jumia',
          jumiaIntegrationId: 'int-1',
        })
      );
    });
  });

  it('filters initial orders to agentic source when source=agentic is present', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('source=agentic') as never
    );

    render(
      <OrdersClientPage
        initialOrders={[
          {
            id: 'order-agentic',
            orderNumber: 'ORD-AGENTIC',
            customerName: 'Ada Agent',
            total: 5000,
            currency: 'NGN',
            shippingStatus: 'Pending',
            paymentStatus: 'Pending',
            paymentMethod: 'bank_transfer',
            date: 'May 22, 2026',
            createdAt: Date.now(),
            source: 'agentic_ai',
            items: [
              {
                id: 'item-agentic',
                name: 'Agentic Phone',
                quantity: 1,
                price: 5000,
              },
            ],
          },
          {
            id: 'order-whatsapp',
            orderNumber: 'ORD-WHATSAPP',
            customerName: 'Wale WhatsApp',
            total: 3000,
            currency: 'NGN',
            shippingStatus: 'Pending',
            paymentStatus: 'Pending',
            paymentMethod: 'transfer',
            date: 'May 22, 2026',
            createdAt: Date.now(),
            source: 'whatsapp',
            items: [
              {
                id: 'item-whatsapp',
                name: 'WhatsApp Phone',
                quantity: 1,
                price: 3000,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText('1 item: Agentic Phone')).toBeInTheDocument();
    expect(
      screen.queryByText('1 item: WhatsApp Phone')
    ).not.toBeInTheDocument();
  });
});
