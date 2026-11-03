import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredCryptoSelectorModal } from './DeferredCryptoSelectorModal';

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(
    <DeferredCryptoSelectorModal
      selectedCryptoCurrency="USDT"
      selectedCryptoChain="TRX"
      isInitializingCrypto={false}
      onCurrencyChange={vi.fn()}
      onChainChange={vi.fn()}
      onInitialize={vi.fn()}
      onClose={onClose}
    />
  );

  // A cold lazy import includes the shared checkout utilities. Wait for the
  // dialog to load instead of treating the default 1-second query limit as SLA.
  expect(
    await screen.findByRole(
      'dialog',
      { name: 'Select Crypto Payment' },
      { timeout: 3000 }
    )
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /close/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
