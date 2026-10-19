import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredWalletTransferConsentDialog } from './DeferredWalletTransferConsentDialog';

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(<DeferredWalletTransferConsentDialog merchantName="Test Store" onAccept={vi.fn()} onDecline={onClose} />);

  expect(await screen.findByRole('button', { name: /create my account/i })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /not now/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
