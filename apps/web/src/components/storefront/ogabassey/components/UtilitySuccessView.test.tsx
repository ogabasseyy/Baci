import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UtilitySuccessView } from './UtilitySuccessView';

describe('UtilitySuccessView', () => {
  it('renders transaction details and closes the modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={1500}
        onClose={onClose}
        reference="VTU-123"
      />
    );

    expect(screen.getByText('airtime')).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText('VTU-123')).toBeInTheDocument();

    const doneButton = screen.getByRole('button', { name: 'Done' });
    expect(doneButton).toHaveClass('bg-store-primary');

    await user.click(doneButton);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the pending state while a purchase is processing', () => {
    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={1500}
        onClose={vi.fn()}
        processing={true}
        reference="VTU-123"
      />
    );

    expect(screen.getByText('Processing…')).toBeInTheDocument();
    expect(
      screen.getByText(/still fail or be refunded/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Success!')).not.toBeInTheDocument();
  });

  it('renders the prepaid voucher token when the vend returns one', () => {
    render(
      <UtilitySuccessView
        activeTab="electricity"
        amount={1000}
        onClose={vi.fn()}
        reference="VTU-456"
        voucherPin="1234-5678-9012"
      />
    );

    expect(screen.getByText('Voucher / Token')).toBeInTheDocument();
    expect(screen.getByText('1234-5678-9012')).toBeInTheDocument();
  });

  it('omits the voucher row when no token was returned', () => {
    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={500}
        onClose={vi.fn()}
        reference="VTU-789"
      />
    );

    expect(screen.queryByText('Voucher / Token')).not.toBeInTheDocument();
  });

  it('backfills a late voucher on a processing bill purchase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-PROC',
              status: 'successful',
              voucher_pin: 'BACKFILLED-PIN',
            },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-PROC"
        />
      );

      // The reconciler-persisted token flips the card to success.
      expect(await screen.findByText('Success!')).toBeInTheDocument();
      expect(screen.getByText('BACKFILLED-PIN')).toBeInTheDocument();
      expect(screen.queryByText('Processing…')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders terminal failure once the refund is confirmed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-FAIL',
              status: 'failed',
              refund_pending: false,
              refunded_to_wallet: 1000,
            },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-FAIL"
        />
      );

      expect(await screen.findByText('Purchase failed')).toBeInTheDocument();
      expect(screen.getByText(/1,000 was refunded/)).toBeInTheDocument();
      // Themed danger tokens (not hardcoded red) so merchant palettes apply.
      const icon = screen.getByText('Purchase failed').parentElement
        ?.children[0];
      expect(icon?.className).toContain('store-danger-bg');
      expect(icon?.className).toContain('store-danger-text');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never claims a refund while one is still pending', async () => {
    // Failed persists before the refund RPC runs: an unconfirmed
    // failure must not say the amount was refunded.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-FAIL',
              status: 'failed',
              refund_pending: true,
            },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-FAIL"
        />
      );

      expect(await screen.findByText('Purchase failed')).toBeInTheDocument();
      expect(screen.getByText(/being processed/)).toBeInTheDocument();
      expect(screen.queryByText(/was refunded/)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('flips pin-less backfilled success to the success screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-PROC',
              status: 'successful',
              refund_pending: false,
            },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="tv"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-PROC"
        />
      );

      expect(await screen.findByText('Success!')).toBeInTheDocument();
      expect(screen.queryByText('Voucher / Token')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('notifies the owner exactly once when the backfill settles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-PROC',
              status: 'successful',
              voucher_pin: 'PIN-1',
              refund_pending: false,
            },
          ],
        }),
      }))
    );
    const onSettled = vi.fn();
    try {
      const { rerender } = render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          onSettled={onSettled}
          processing={true}
          reference="VTU-PROC"
        />
      );

      expect(await screen.findByText('Success!')).toBeInTheDocument();
      expect(onSettled).toHaveBeenCalledTimes(1);
      rerender(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          onSettled={onSettled}
          processing={true}
          reference="VTU-PROC"
        />
      );
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('polls telco processing purchases for settlement', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      json: async () => ({
        transactions: [
          { request_reference: 'VTU-TELCO', status: 'processing' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(
        <UtilitySuccessView
          activeTab="airtime"
          amount={500}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-TELCO"
        />
      );

      expect(
        await screen.findByText(/updates automatically when it settles/)
      ).toBeInTheDocument();
      expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain(
        'type=airtime'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never notifies the owner for an immediate (non-backfilled) outcome', () => {
    const onSettled = vi.fn();
    render(
      <UtilitySuccessView
        activeTab="airtime"
        amount={1500}
        onClose={vi.fn()}
        onSettled={onSettled}
        reference="VTU-123"
        voucherPin="PIN-0"
      />
    );

    expect(screen.getByText('Success!')).toBeInTheDocument();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('shows polling copy while a processing purchase is still missing its outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            { request_reference: 'VTU-PROC', status: 'processing' },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={true}
          reference="VTU-PROC"
        />
      );

      expect(screen.getByText('Processing…')).toBeInTheDocument();
      expect(
        screen.getByText(/updates automatically when it settles/)
      ).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('polls for a late token on a successful pin-less bill purchase', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transactions: [
          {
            request_reference: 'VTU-TOK',
            status: 'successful',
            voucher_pin: 'LATE-TOKEN',
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={false}
          reference="VTU-TOK"
        />
      );

      // The poll starts even though the purchase already succeeded,
      // and the late token surfaces on the success card.
      expect(await screen.findByText('LATE-TOKEN')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not poll on a successful pin-less telco purchase', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transactions: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(
        <UtilitySuccessView
          activeTab="airtime"
          amount={500}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          processing={false}
          reference="VTU-TEL"
        />
      );

      expect(screen.getByText('Success!')).toBeInTheDocument();
      // Let any would-be poll fire: none should.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never notifies the owner from a success-view token hunt', async () => {
    const onSettled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transactions: [
            {
              request_reference: 'VTU-TOK2',
              status: 'successful',
              voucher_pin: 'LATE-TOKEN-2',
            },
          ],
        }),
      }))
    );
    try {
      render(
        <UtilitySuccessView
          activeTab="power"
          amount={1000}
          merchantSlug="ogabassey"
          onClose={vi.fn()}
          onSettled={onSettled}
          processing={false}
          reference="VTU-TOK2"
        />
      );

      expect(await screen.findByText('LATE-TOKEN-2')).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onSettled).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
