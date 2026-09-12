import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredWalletFundedTransferModal } from './DeferredWalletFundedTransferModal';

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(<DeferredWalletFundedTransferModal account={{accountName:"Test",accountNumber:"1234567890",bankName:"Wema",provider:"paystack"}} copiedText={null} error={null} formatCurrency={String} intent={{currency:"NGN",expectedAmount:5000,expiresAt:"2026-09-08T00:00:00Z",fundedAmount:0,id:"intent",orderId:"order",status:"pending",targetOrderAmount:5000}} isChecking={false} onCheckNow={vi.fn()} onClose={onClose} onCopy={vi.fn()} />);

  expect(await screen.findByText('1234567890')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /close and check later/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
