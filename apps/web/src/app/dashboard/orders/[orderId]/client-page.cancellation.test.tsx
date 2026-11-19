import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiPost } from '@/lib/api-client';

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

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  fetchWithCsrf: vi.fn(),
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
  Circle: () => <span />,
  X: () => <span />,
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
    amountPaid: 5000,
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

describe('OrderDetailsClientPage cancellation', () => {
  it('keeps the cancel dialog open when the cancellation fails', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('boom'));
    render(
      <OrderDetailsClientPage
        initialOrder={makeOrder({
          transactions: [
            {
              amount: 5000,
              currency: 'NGN',
              gateway: 'paystack',
              gateway_reference: 'ref-1',
              id: 'leg-1',
              status: 'completed',
              transaction_type: 'payment',
            },
          ],
        } as Partial<Order>)}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /cancel order/i })
    );
    await userEvent.click(screen.getByRole('radio', { name: /cancel only/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

    expect(apiPost).toHaveBeenCalledWith(
      '/api/orders/order-123/cancelled',
      expect.objectContaining({ refund: 'manual' })
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /cancel only/i })).toBeChecked();
  });
});
