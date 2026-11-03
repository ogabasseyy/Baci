import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredWalletFundedTransferModal } from './DeferredWalletFundedTransferModal';

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(
    <DeferredWalletFundedTransferModal
      account={{
        accountName: 'Test',
        accountNumber: '1234567890',
        bankName: 'Wema',
        provider: 'paystack',
      }}
      copiedText={null}
      error={null}
      formatCurrency={String}
      intent={{
        currency: 'NGN',
        expectedAmount: 5000,
        expiresAt: '2026-09-08T00:00:00Z',
        fundedAmount: 0,
        id: 'intent',
        orderId: 'order',
        status: 'pending',
        targetOrderAmount: 5000,
      }}
      isChecking={false}
      onCheckNow={vi.fn()}
      onClose={onClose}
      onCopy={vi.fn()}
    />
  );

  // React may insert the suspended tree before revealing it. Wait for visible
  // content rather than asserting visibility as soon as the text exists.
  await waitFor(() => expect(screen.getByText('1234567890')).toBeVisible(), {
    timeout: 3000,
  });
  fireEvent.click(
    screen.getByRole('button', { name: /close and check later/i })
  );

  expect(onClose).toHaveBeenCalledTimes(1);
});
