import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatOrderPanel } from './chat-order-panel';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('chat order panel', () => {
  it('does not request account data until the customer explicitly opens it', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(
      <ChatOrderPanel
        merchantSlug="ogabassey"
        basePath=""
        scope={{
          status: 'ready',
          revision: 0,
          capture: () => 0,
          isCurrent: () => true,
          cancellationUncertain: false,
          cancellationBusy: false,
          startCancellation: () => true,
          finishCancellation: () => undefined,
          resolveCancellationWarning: () => undefined,
          isCancellationBlocked: () => false,
          isCancellationResolved: () => false,
        }}
      />
    );
    expect(fetcher).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /view my orders/i }));
    expect(
      await screen.findByRole('link', { name: /sign in/i })
    ).toHaveAttribute('href', '/account/login');
    fetcher.mockRestore();
  });
  it('resumes an unpaid Pay Small Small order in chat', async () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440000';
    const resume = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        orders: [
          {
            id: orderId,
            order_number: 'QA-1',
            payment_method: 'oxygen',
            payment_status: 'unpaid',
            shipping_status: 'pending',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            order_number: 'QA-2',
            payment_method: 'oxygen',
            payment_status: 'paid',
            shipping_status: 'pending',
          },
        ],
      })
    );
    const shopper = userEvent.setup();
    render(
      <ChatOrderPanel
        merchantSlug="ogabassey"
        basePath=""
        onContinueApplication={resume}
        scope={{
          status: 'ready',
          revision: 0,
          capture: () => 0,
          isCurrent: () => true,
          cancellationUncertain: false,
          cancellationBusy: false,
          startCancellation: () => true,
          finishCancellation: () => undefined,
          resolveCancellationWarning: () => undefined,
          isCancellationBlocked: () => false,
          isCancellationResolved: () => false,
        }}
      />
    );
    await shopper.click(screen.getByRole('button', { name: 'View my orders' }));
    await shopper.click(await screen.findByRole('button', { name: 'Continue Pay Small Small' }));
    expect(resume).toHaveBeenCalledExactlyOnceWith(orderId);
    fetcher.mockRestore();
  });
});
