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
});
