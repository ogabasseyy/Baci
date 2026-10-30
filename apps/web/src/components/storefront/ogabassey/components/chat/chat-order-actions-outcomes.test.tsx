import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { ChatOrderActions } from './chat-order-actions';
import { resetChatCancellationStateForTests } from './chat-cancellation-state';

const mocks = vi.hoisted(() => ({
  merchant: { slug: 'ogabassey' },
  fetchWithCsrf: vi.fn(),
  authListeners: new Set<(event: string) => void>(),
}));
vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey', merchant: mocks.merchant }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetchWithCsrf }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: (event: string) => void) => {
        mocks.authListeners.add(listener);
        return {
          data: {
            subscription: {
              unsubscribe: () => mocks.authListeners.delete(listener),
            },
          },
        };
      },
    },
  }),
}));

const orderId = '11111111-1111-4111-8111-111111111111';
const order = {
  id: orderId,
  order_number: 'ORD-42',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  customer_email: 'private@example.com',
};

async function loadOrder() {
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: /view my orders/i }));
  await screen.findByRole('button', { name: /cancel order ORD-42/i });
}

describe('ChatOrderActions', () => {
  beforeEach(() => {
    resetChatCancellationStateForTests();
    mocks.merchant = { slug: 'ogabassey' };
    mocks.fetchWithCsrf.mockReset();
    global.fetch = vi.fn();
  });

  it('clears previously displayed orders when the customer is signed out', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(null, { status: 401 })
    );
    await user.click(screen.getByRole('button', { name: /refresh orders/i }));
    await screen.findByRole('link', { name: /sign in/i });
    expect(screen.queryByText('Order ORD-42')).toBeNull();
  });

  it('reports a rejected cancellation without claiming success or replaying it', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockResolvedValueOnce(
      new Response(null, { status: 409 })
    );
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    expect(
      await screen.findByText(/can no longer be cancelled/i)
    ).toBeDefined();
    expect(screen.queryByText('Your order was cancelled.')).toBeNull();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  });

  it('does not offer cancellation for a paid or fulfilled order', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({
        orders: [
          { ...order, payment_status: 'paid', shipping_status: 'shipped' },
        ],
      })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    await screen.findByText(/Payment: paid/i);
    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });

  it('does not claim success for an invalid success response', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockResolvedValueOnce(Response.json({ ok: true }));
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    expect(await screen.findByText(/could not confirm/i)).toBeDefined();
    expect(screen.queryByText('Your order was cancelled.')).toBeNull();
  });

  it.each([
    new Response(null, { status: 500 }),
    Response.json({ orders: [{ id: 'invalid' }] }),
  ])('shows an error for an unavailable or invalid order list', async (response) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(response);
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn’t load your orders/i
    );
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('limits the displayed orders and links to the full account list', async () => {
    const orders = Array.from({ length: 21 }, (_, i) => ({
      ...order,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      order_number: `ORD-${i}`,
    }));
    vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders }));
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    expect(
      await screen.findAllByRole('link', { name: 'View order details' })
    ).toHaveLength(20);
    expect(
      screen.getByRole('link', { name: 'View all orders' })
    ).toHaveAttribute('href', '/ogabassey/account/orders');
  });

  it('does not send a duplicate request when the confirm button is clicked twice', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    mocks.fetchWithCsrf.mockReturnValueOnce(new Promise(() => {}));
    const confirm = screen.getByRole('button', {
      name: /confirm cancellation/i,
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1));
  });

  it('allows a different order while an earlier cancellation remains uncertain', async () => {
    const other = {
      ...order,
      id: '22222222-2222-4222-8222-222222222222',
      order_number: 'ORD-99',
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ orders: [order, other] })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /view my orders/i }));
    await user.click(
      await screen.findByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('request timed out'));
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    await screen.findByText(/could not confirm/i);
    expect(
      screen.getByRole('button', { name: /cancel order ORD-99/i })
    ).toBeEnabled();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-99/i })
    );
    mocks.fetchWithCsrf.mockResolvedValueOnce(
      Response.json({ success: true, cancelled: true })
    );
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    expect(
      await screen.findByText(/^Your order was cancelled\.$/i)
    ).toBeDefined();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(2);
  });

  it('allows the next account to act while preserving the previous order lock', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('request timed out'));
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    await screen.findByText(/could not confirm/i);
    act(() => publishCustomerIdentity({ id: 'user-b' }, { id: 'customer-b' }, 'ogabassey'));
    expect(screen.queryByText(/cancellation.*check.*status/i)).toBeNull();
    const other = {
      ...order,
      id: '22222222-2222-4222-8222-222222222222',
      order_number: 'ORD-99',
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders: [other] }));
    await user.click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByRole('button', { name: /cancel order ORD-99/i })).toBeEnabled();
    act(() => publishCustomerIdentity({ id: 'user-a' }, { id: 'customer-a' }, 'ogabassey'));
    vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders: [order] }));
    await user.click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByRole('button', { name: /cancel order ORD-42/i })).toBeDisabled();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  });
});
