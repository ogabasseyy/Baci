import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatOrderActions } from './chat-order-actions';

const mocks = vi.hoisted(() => ({
  merchant: { slug: 'ogabassey' },
  fetchWithCsrf: vi.fn(),
}));
vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey', merchant: mocks.merchant }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetchWithCsrf }));

const orderId = '11111111-1111-4111-8111-111111111111';
const order = {
  id: orderId,
  order_number: 'ORD-42',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  customer_email: 'private@example.com',
};

async function loadOrder() {
  vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders: [order] }));
  await userEvent.setup().click(screen.getByRole('button', { name: /view my orders/i }));
  await screen.findByRole('button', { name: /cancel order ORD-42/i });
}

describe('ChatOrderActions', () => {
  beforeEach(() => {
    mocks.merchant = { slug: 'ogabassey' };
    mocks.fetchWithCsrf.mockReset();
    global.fetch = vi.fn();
  });

  it('does not access an account until the customer asks to view orders', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
    await loadOrder();
    expect(global.fetch).toHaveBeenCalledWith('/api/storefront/orders?merchantSlug=ogabassey', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByText(/Payment: unpaid/i)).toBeDefined();
    expect(screen.getByText(/Delivery: pending/i)).toBeDefined();
    expect(screen.queryByText('private@example.com')).toBeNull();
  });

  it('refuses to show controls if the reply tenant and current storefront differ', () => {
    render(<ChatOrderActions merchantSlug="another-store" />);
    expect(screen.queryByRole('button', { name: /view my orders/i })).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires a separate explicit confirmation before cancellation', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
    mocks.fetchWithCsrf.mockResolvedValueOnce(Response.json({ success: true, cancelled: true }));
    await user.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithCsrf).toHaveBeenCalledWith(`/api/storefront/account/orders/${orderId}/cancel`, expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/order was cancelled/i)).toBeDefined();
    expect(screen.getByText('Delivery: cancelled')).toBeDefined();
    expect(screen.queryByText('Delivery: pending')).toBeNull();
  });

  it('shows sign-in guidance for unauthenticated customers without a write', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/ogabassey/account/login');
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('does not replay or assert cancellation when the response is ambiguous', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('network lost'));
    await user.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    expect(await screen.findByText(/could not confirm/i)).toBeDefined();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /confirm cancellation/i })).toBeNull();
  });

  it('clears previously displayed orders when the customer is signed out', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await user.click(screen.getByRole('button', { name: /refresh orders/i }));
    await screen.findByRole('link', { name: /sign in/i });
    expect(screen.queryByText('Order ORD-42')).toBeNull();
  });

  it('reports a rejected cancellation without claiming success or replaying it', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    mocks.fetchWithCsrf.mockResolvedValueOnce(new Response(null, { status: 409 }));
    await user.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    expect(await screen.findByText(/can no longer be cancelled/i)).toBeDefined();
    expect(screen.queryByText('Your order was cancelled.')).toBeNull();
    expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  });

  it('does not offer cancellation for a paid or fulfilled order', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders: [{ ...order, payment_status: 'paid', shipping_status: 'shipped' }] }));
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /view my orders/i }));
    await screen.findByText(/Payment: paid/i);
    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });

  it('does not claim success for an invalid success response', async () => {
    const user = userEvent.setup();
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await user.click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    mocks.fetchWithCsrf.mockResolvedValueOnce(Response.json({ ok: true }));
    await user.click(screen.getByRole('button', { name: /confirm cancellation/i }));
    expect(await screen.findByText(/could not confirm/i)).toBeDefined();
    expect(screen.queryByText('Your order was cancelled.')).toBeNull();
  });

  it.each([
    new Response(null, { status: 500 }),
    Response.json({ orders: [{ id: 'invalid' }] }),
  ])('shows an error for an unavailable or invalid order list', async (response) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(response);
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your orders/i);
    expect(mocks.fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('limits the displayed orders and links to the full account list', async () => {
    const orders = Array.from({ length: 21 }, (_, i) => ({ ...order, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, order_number: `ORD-${i}` }));
    vi.mocked(global.fetch).mockResolvedValueOnce(Response.json({ orders }));
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /view my orders/i }));
    expect(await screen.findAllByRole('link', { name: 'View order details' })).toHaveLength(20);
    expect(screen.getByRole('link', { name: 'View all orders' })).toHaveAttribute('href', '/ogabassey/account/orders');
  });

  it('does not send a duplicate request when the confirm button is clicked twice', async () => {
    render(<ChatOrderActions merchantSlug="ogabassey" />);
    await loadOrder();
    await userEvent.setup().click(screen.getByRole('button', { name: /cancel order ORD-42/i }));
    mocks.fetchWithCsrf.mockReturnValueOnce(new Promise(() => {}));
    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1));
  });
});
