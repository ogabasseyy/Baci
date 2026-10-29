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

  it('does not access an account until the customer asks to view orders', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
    await loadOrder();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/storefront/orders?merchantSlug=ogabassey',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(screen.getByText(/Payment: unpaid/i)).toBeDefined();
    expect(screen.getByText(/Delivery: pending/i)).toBeDefined();
    expect(screen.queryByText('private@example.com')).toBeNull();
  });

  it('refuses to show controls if the reply tenant and current storefront differ', () => {
    render(<ChatOrderActions merchantSlug="another-store" />);
    expect(
      screen.queryByRole('button', { name: /view my orders/i })
    ).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears displayed order data immediately when the buyer signs out', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    expect(screen.queryByText('Order ORD-42')).toBeNull();
    expect(screen.queryByText(/Payment: unpaid/i)).toBeNull();
  });

  it.each([
    'INITIAL_SESSION',
    'TOKEN_REFRESHED',
  ])('keeps order data for a non-identity auth event: %s', async (event) => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    act(() => {
      for (const listener of mocks.authListeners) listener(event);
    });
    expect(screen.getByText('Order ORD-42')).toBeDefined();
  });

  it('clears displayed orders when another store changes the shared account', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'baci:customer-identity-changed',
          newValue: JSON.stringify({
            type: 'invalidate',
            source: 'another-tab',
            merchantSlug: 'other-store',
            sequence: 1,
          }),
        })
      )
    );
    expect(screen.queryByText('Order ORD-42')).toBeNull();
  });

  it('discards an in-flight order list when another tab changes identity', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(global.fetch).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'baci:customer-identity-changed',
          newValue: JSON.stringify({
            type: 'invalidate',
            source: 'another-tab',
            merchantSlug: 'ogabassey',
            sequence: 1,
          }),
        })
      )
    );
    await act(async () => {
      resolve(Response.json({ orders: [order] }));
    });
    expect(screen.queryByText('Order ORD-42')).toBeNull();
  });

  it('clears order details when the customer returns to the tab', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByText('Order ORD-42')).toBeNull();
  });

  it('warns about an unresolved cancellation if the customer returns during it', async () => {
    let resolve!: (response: Response) => void;
    mocks.fetchWithCsrf.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.getByText(/cancellation.*check.*status/i)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /view my orders/i })
    ).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(Response.json({ success: true, cancelled: true }));
    });
    expect(screen.getByText(/cancellation.*check.*status/i)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /view my orders/i })
    ).toBeEnabled();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ orders: [{ ...order, shipping_status: 'cancelled' }] })
    );
    await user.click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByText(/Delivery: cancelled/i)).toBeDefined();
    expect(screen.queryByText(/cancellation.*check.*status/i)).toBeNull();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  });

  it('discards an order response that settles after the buyer changes', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(global.fetch).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    act(() => {
      for (const listener of mocks.authListeners) listener('SIGNED_OUT');
    });
    await act(async () => {
      resolve(Response.json({ orders: [order] }));
    });
    expect(screen.queryByText('Order ORD-42')).toBeNull();
    expect(screen.queryByText(/Payment: unpaid/i)).toBeNull();
  });

  it('does not display a cancellation result after an identity transition', async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    mocks.fetchWithCsrf.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    await act(async () => {
      resolve(Response.json({ success: true, cancelled: true }));
    });
    expect(screen.queryByText('Your order was cancelled.')).toBeNull();
    expect(screen.queryByText('Order ORD-42')).toBeNull();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  });

  it('requires a separate explicit confirmation before cancellation', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
    mocks.fetchWithCsrf.mockResolvedValueOnce(
      Response.json({ success: true, cancelled: true })
    );
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithCsrf).toHaveBeenCalledWith(
      `/api/storefront/account/orders/${orderId}/cancel`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(await screen.findByText(/order was cancelled/i)).toBeDefined();
    expect(screen.getByText('Delivery: cancelled')).toBeDefined();
    expect(screen.queryByText('Delivery: pending')).toBeNull();
  });

  it('shows sign-in guidance for unauthenticated customers without a write', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(null, { status: 401 })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    expect(
      await screen.findByRole('link', { name: /sign in/i })
    ).toHaveAttribute('href', '/ogabassey/account/login');
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('does not replay or assert cancellation when the response is ambiguous', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('network lost'));
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    expect(await screen.findByText(/could not confirm/i)).toBeDefined();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /confirm cancellation/i })
    ).toBeNull();
  });

  it('does not clear an uncertain cancellation after a stale pending-status read', async () => {
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
    expect(
      await screen.findByText(/cancellation.*check.*status/i)
    ).toBeDefined();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ orders: [order] })
    );
    await user.click(screen.getByRole('button', { name: /refresh orders/i }));
    expect(await screen.findByText(/Delivery: pending/i)).toBeDefined();
    expect(screen.getByText(/cancellation.*check.*status/i)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    ).toBeDisabled();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ orders: [{ ...order, shipping_status: 'cancelled' }] })
    );
    await user.click(screen.getByRole('button', { name: /refresh orders/i }));
    expect(await screen.findByText(/Delivery: cancelled/i)).toBeDefined();
    expect(screen.queryByText(/cancellation.*check.*status/i)).toBeNull();
  });

  it('keeps an uncertain cancellation blocked after the chat panel remounts', async () => {
    const first = render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /cancel order ORD-42/i })
    );
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('request timed out'));
    await user.click(
      screen.getByRole('button', { name: /confirm cancellation/i })
    );
    await screen.findByText(/cancellation.*check.*status/i);
    first.unmount();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ orders: [order] })
    );
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await user.click(screen.getByRole('button', { name: /view my orders/i }));
    expect(
      await screen.findByRole('button', { name: /cancel order ORD-42/i })
    ).toBeDisabled();
    expect(screen.getByText(/cancellation.*check.*status/i)).toBeDefined();
  });

  it('blocks a second chat message from cancelling the same order while the first is pending', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(Response.json({ orders: [order] }))
      .mockResolvedValueOnce(Response.json({ orders: [order] }));
    render(
      <>
        <ChatOrderActions merchantSlug="ogabassey" />
        <ChatOrderActions merchantSlug="ogabassey" />
      </>
    );
    const panels = screen.getAllByRole('region', {
      name: 'Secure order actions',
    });
    const user = userEvent.setup();
    await user.click(
      within(panels[0]).getByRole('button', { name: /view my orders/i })
    );
    await user.click(
      within(panels[1]).getByRole('button', { name: /view my orders/i })
    );
    const firstCancel = await within(panels[0]).findByRole('button', {
      name: /cancel order ORD-42/i,
    });
    await user.click(firstCancel);
    let resolve!: (response: Response) => void;
    mocks.fetchWithCsrf.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await user.click(
      within(panels[0]).getByRole('button', { name: /confirm cancellation/i })
    );
    expect(
      within(panels[1]).getByRole('button', { name: /cancel order ORD-42/i })
    ).toBeDisabled();
    await act(async () => {
      resolve(Response.json({ success: true, cancelled: true }));
    });
    expect(
      within(panels[1]).getByRole('button', { name: /cancel order ORD-42/i })
    ).toBeDisabled();
    expect(
      within(panels[1]).getByText(/status may have changed/i)
    ).toBeDefined();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
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
});
