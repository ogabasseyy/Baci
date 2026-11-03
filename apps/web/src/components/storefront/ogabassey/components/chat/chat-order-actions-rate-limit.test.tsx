import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import {
  chatCancellationState,
  resetChatCancellationStateForTests,
} from './chat-cancellation-state';
import { ChatOrderActions } from './chat-order-actions';

const mocks = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));
vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({
    basePath: '/ogabassey',
    merchant: { slug: 'ogabassey' },
  }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetchWithCsrf }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

const orderId = '11111111-1111-4111-8111-111111111111';
const order = {
  id: orderId,
  order_number: 'ORD-42',
  payment_status: 'unpaid',
  shipping_status: 'pending',
};

beforeEach(() => {
  resetChatCancellationStateForTests();
  mocks.fetchWithCsrf.mockReset();
  global.fetch = vi.fn();
});

it('allows a deliberate retry after a definite rate-limit rejection', async () => {
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  render(<ChatOrderActions merchantSlug="ogabassey" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /view my orders/i }));
  await user.click(
    await screen.findByRole('button', { name: /cancel order ORD-42/i })
  );
  mocks.fetchWithCsrf.mockResolvedValueOnce(
    new Response(null, { status: 429 })
  );
  await user.click(
    screen.getByRole('button', { name: /confirm cancellation/i })
  );
  expect(await screen.findByText(/too many.*try again/i)).toBeDefined();
  expect(chatCancellationState('ogabassey', orderId)).toBeUndefined();
  expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  await user.click(screen.getByRole('button', { name: /refresh orders/i }));
  await user.click(
    await screen.findByRole('button', { name: /cancel order ORD-42/i })
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

it('releases a rate-limited order after an account change without displaying its response', async () => {
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  render(<ChatOrderActions merchantSlug="ogabassey" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /view my orders/i }));
  await user.click(
    await screen.findByRole('button', { name: /cancel order ORD-42/i })
  );
  let finish!: (response: Response) => void;
  mocks.fetchWithCsrf.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    })
  );
  await user.click(
    screen.getByRole('button', { name: /confirm cancellation/i })
  );
  act(() =>
    publishCustomerIdentity({ id: 'user-b' }, { id: 'customer-b' }, 'ogabassey')
  );
  await act(async () => finish(new Response(null, { status: 429 })));
  await waitFor(() =>
    expect(chatCancellationState('ogabassey', orderId)).toBeUndefined()
  );
  expect(screen.queryByText(/too many.*try again/i)).toBeNull();
  expect(
    screen.queryByText(/cancellation may still be processing/i)
  ).toBeNull();
});

it('releases a definite rejection even if the widget unmounts before the response', async () => {
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  const view = render(<ChatOrderActions merchantSlug="ogabassey" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /view my orders/i }));
  await user.click(
    await screen.findByRole('button', { name: /cancel order ORD-42/i })
  );
  let finish!: (response: Response) => void;
  mocks.fetchWithCsrf.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    })
  );
  await user.click(
    screen.getByRole('button', { name: /confirm cancellation/i })
  );
  view.unmount();
  await act(async () => finish(new Response(null, { status: 429 })));
  await waitFor(() =>
    expect(chatCancellationState('ogabassey', orderId)).toBeUndefined()
  );
  vi.mocked(global.fetch).mockResolvedValueOnce(
    Response.json({ orders: [order] })
  );
  render(<ChatOrderActions merchantSlug="ogabassey" />);
  await user.click(screen.getByRole('button', { name: /view my orders/i }));
  expect(
    await screen.findByRole('button', { name: /cancel order ORD-42/i })
  ).toBeEnabled();
  expect(mocks.fetchWithCsrf).toHaveBeenCalledTimes(1);
});
