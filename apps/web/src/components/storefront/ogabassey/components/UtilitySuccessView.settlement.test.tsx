import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { UtilitySuccessView } from './UtilitySuccessView';

beforeEach(() => {
  publishCustomerIdentity({ id: 'user-1' }, null, 'ogabassey');
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
  const view = (
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
  try {
    const { rerender } = render(view);
    expect(await screen.findByText('Success!')).toBeInTheDocument();
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
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
    await act(async () => {});
    expect(onSettled).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
