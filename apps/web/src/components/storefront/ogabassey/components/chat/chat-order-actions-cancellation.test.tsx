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
});
