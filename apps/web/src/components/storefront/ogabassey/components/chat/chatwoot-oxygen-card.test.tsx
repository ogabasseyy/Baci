import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatwootOxygenCard } from './chatwoot-oxygen-card';

const dialogProps = vi.fn();

vi.mock('@/components/payments/oxygen/OxygenApplicationDialog', () => ({
  OxygenApplicationDialog: (props: Record<string, unknown>) => {
    dialogProps(props);
    return <div data-testid="oxygen-dialog">Embedded Oxygen Dialog</div>;
  },
}));

describe('ChatwootOxygenCard', () => {
  const fetchMock = vi.fn();
  let holder: HTMLDivElement;
  let widget: HTMLIFrameElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    holder = document.createElement('div');
    holder.id = 'cw-widget-holder';
    widget = document.createElement('iframe');
    widget.id = 'chatwoot_live_chat_widget';
    widget.inert = false;
    holder.appendChild(widget);
    document.body.appendChild(holder);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('loads order contact, marks widget inert, forwards hostedOrigins, and restores widget state on hide/resume', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        order: {
          id: '60000000-0000-4000-8000-000000000001',
          payment_method: 'oxygen',
          customer_name: 'Ada Obi',
          customer_email: 'ada@example.com',
        },
      })
    );

    render(
      <ChatwootOxygenCard
        orderId="60000000-0000-4000-8000-000000000001"
        storeSlug="savings-synthetic"
        hostedOrigins={['https://payment.hydrogenpay.com']}
      />
    );

    expect(await screen.findByTestId('oxygen-dialog')).toBeInTheDocument();
    expect(widget.inert).toBe(true);
    expect(dialogProps).toHaveBeenCalledWith(
      expect.objectContaining({
        embedded: true,
        orderId: '60000000-0000-4000-8000-000000000001',
        merchantSlug: 'savings-synthetic',
        hostedOrigins: ['https://payment.hydrogenpay.com'],
        prefill: {
          first_name: 'Ada',
          last_name: 'Obi',
          email: 'ada@example.com',
        },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }));
    expect(widget.inert).toBe(false);
    expect(screen.queryByTestId('oxygen-dialog')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /continue secure application/i })
    );
    await waitFor(() => expect(widget.inert).toBe(true));
    expect(await screen.findByTestId('oxygen-dialog')).toBeInTheDocument();
  });

  it('shows a retryable error on mismatched or failed order lookup and recovers on retry', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          order: {
            id: 'other-order-id',
            payment_method: 'paystack',
            customer_name: 'Ada Obi',
            customer_email: 'ada@example.com',
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          order: {
            id: '60000000-0000-4000-8000-000000000001',
            payment_method: 'oxygen',
            customer_name: 'Ada Obi',
            customer_email: 'ada@example.com',
          },
        })
      );

    render(
      <ChatwootOxygenCard
        orderId="60000000-0000-4000-8000-000000000001"
        storeSlug="savings-synthetic"
      />
    );

    expect(
      await screen.findByText('I couldn’t load the details from your checkout.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('oxygen-dialog')).toBeInTheDocument();
  });
});
