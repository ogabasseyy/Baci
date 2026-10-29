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
});
