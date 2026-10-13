import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// --- Mocks ---

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    // biome-ignore lint/performance/noImgElement: Test mock for next/image intentionally uses <img>
    <img {...props} alt={props.alt as string} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('../actions', () => ({
  resendOrderConfirmation: vi.fn(),
}));

vi.mock('../status-badge', () => ({
  StatusBadge: ({ status, type }: { status: string; type: string }) => (
    <span data-testid={`status-badge-${type}`}>{status}</span>
  ),
}));

vi.mock('../order-source-icon', () => ({
  OrderSourceIcon: ({ source }: { source: string }) => (
    <span data-testid="order-source-icon">{source}</span>
  ),
}));

vi.mock('../order-source-display', () => ({
  getOrderSourceLabel: (s: string) => `Label: ${s}`,
}));

vi.mock('./confirm-insurance-dialog', () => ({
  default: () => <div data-testid="confirm-insurance-dialog" />,
}));

vi.mock('lucide-react', () => ({
  CheckCircle: () => <span />,
  ChevronLeft: () => <span />,
  Copy: () => <span />,
  Download: () => <span />,
  Edit: () => <span />,
  Mail: () => <span />,
  MoreVertical: () => <span />,
  Package: () => <span />,
  PackageCheck: () => <span />,
  Phone: () => <span />,
  Send: () => <span />,
  Share2: () => <span />,
  Truck: () => <span />,
  Undo2: () => <span />,
  XCircle: () => <span />,
}));

// --- Import after mocks ---

import type { Order } from '../actions';
import OrderDetailsClientPage from './client-page';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-123',
    orderNumber: 'ORD-001',
    customerName: 'Test Customer',
    total: 5000,
    currency: 'NGN',
    paymentStatus: 'Paid',
    shippingStatus: 'Pending',
    paymentMethod: null,
    date: '2026-01-01',
    createdAt: Date.now(),
    source: 'web',
    items: [],
    ...overrides,
  };
}

describe('OrderDetailsClientPage', () => {
  it('renders the order number', () => {
    render(<OrderDetailsClientPage initialOrder={makeOrder()} />);

    expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
  });

  it('renders the customer name', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({ customerName: 'Jane Doe' })}
      />
    );

    // Customer name appears in both order details and shipping card
    const matches = screen.getAllByText('Jane Doe');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the total amount formatted as NGN currency', () => {
    render(
      <OrderDetailsClientPage initialOrder={makeOrder({ total: 15000 })} />
    );

    // The amount appears in both "Sub Total" and "Total Amount" rows
    const matches = screen.getAllByText(/15,000/);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('renders order amounts using the order currency', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({ total: 15000, currency: 'INR' })}
      />
    );

    expect(screen.getAllByText(/₹|INR/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument();
  });

  it('renders a back-to-orders link', () => {
    render(<OrderDetailsClientPage initialOrder={makeOrder()} />);

    const backLink = screen.getByRole('link', { name: 'Back to Orders' });
    expect(backLink).toBeInTheDocument();
  });

  it('renders order source label', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({ source: 'instagram' })}
      />
    );

    expect(screen.getByText('Label: instagram')).toBeInTheDocument();
  });

  it('renders customer contact details when provided', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          customer_email: 'jane@example.com',
          customer_phone: '08012345678',
        })}
      />
    );

    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('08012345678')).toBeInTheDocument();
  });

  it('renders order items when present', () => {
    const order = makeOrder({
      items: [{ id: 'item-1', name: 'Widget', quantity: 2, price: 1500 }],
    });

    render(<OrderDetailsClientPage initialOrder={order} />);

    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('shows no tracking message when tracking_number is absent', () => {
    render(<OrderDetailsClientPage initialOrder={makeOrder()} />);

    expect(
      screen.getByText('No tracking information available.')
    ).toBeInTheDocument();
  });

  it('surfaces the merchant shipping rate name for a merchant-rate order', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          shipping_provider: 'MERCHANT_PICKUP',
          shipping_rate_name: 'Ikeja Store Pickup',
        })}
      />
    );

    // The human rate name (pickup location / zone / tier) is shown instead of
    // the bare `MERCHANT_PICKUP` provider label.
    expect(screen.getByText('Shipping Method')).toBeInTheDocument();
    expect(screen.getByText('Ikeja Store Pickup')).toBeInTheDocument();
    expect(screen.queryByText('MERCHANT_PICKUP')).not.toBeInTheDocument();
    // Merchant-pickup orders have no tracking, yet still show the method.
    expect(
      screen.queryByText('No tracking information available.')
    ).not.toBeInTheDocument();
  });

  it('falls back to the provider label when no shipping rate name is present', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({ shipping_provider: 'Topship' })}
      />
    );

    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Topship')).toBeInTheDocument();
  });

  it('renders persisted airport delivery metadata when address and provider are generic', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          airport_type: 'delivery',
          delivery_method: 'airport',
          shipping_provider: undefined,
        })}
      />
    );

    expect(screen.getByText('Delivery Method')).toBeInTheDocument();
    expect(screen.getByText('Airport Delivery')).toBeInTheDocument();
    expect(screen.getByText('Airport Type')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(
      screen.queryByText('No tracking information available.')
    ).not.toBeInTheDocument();
  });

  it('labels persisted airport pickup metadata as pickup', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          airport_type: 'pickup',
          delivery_method: 'airport',
          shipping_provider: undefined,
        })}
      />
    );

    expect(screen.getByText('Delivery Method')).toBeInTheDocument();
    expect(screen.getByText('Airport Pickup')).toBeInTheDocument();
    expect(screen.getByText('Airport Type')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.queryByText('Airport Delivery')).not.toBeInTheDocument();
  });

  it('renders the pickup collection address and instructions for a merchant-pickup order', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          shipping_provider: 'MERCHANT_PICKUP',
          shipping_rate_name: 'Ikeja Store Pickup',
          shipping_pickup_details: {
            label: 'Ikeja Flagship Store',
            address: '12 Allen Avenue',
            city: 'Ikeja',
            state: 'Lagos',
            countryCode: 'NG',
            instructions: 'Ring the bell twice and ask for Ada',
          },
        })}
      />
    );

    expect(screen.getByText('Pickup Location')).toBeInTheDocument();
    expect(screen.getByText('Ikeja Flagship Store')).toBeInTheDocument();
    expect(
      screen.getByText('12 Allen Avenue, Ikeja, Lagos')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ring the bell twice and ask for Ada')
    ).toBeInTheDocument();
  });

  it('renders no pickup location block when the snapshot is null', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          shipping_provider: 'MERCHANT_PICKUP',
          shipping_rate_name: 'Ikeja Store Pickup',
          shipping_pickup_details: null,
        })}
      />
    );

    expect(screen.queryByText('Pickup Location')).not.toBeInTheDocument();
  });

  it('does not render a pickup location block for a non-pickup order carrying a stray snapshot', () => {
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          shipping_provider: 'MERCHANT',
          shipping_rate_name: 'Express Delivery',
          shipping_pickup_details: {
            label: 'Should Not Show',
            address: '99 Hidden Road',
          },
        })}
      />
    );

    expect(screen.queryByText('Pickup Location')).not.toBeInTheDocument();
    expect(screen.queryByText('Should Not Show')).not.toBeInTheDocument();
  });
});
