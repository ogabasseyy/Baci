import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeferredCryptoSelectorModal } from './DeferredCryptoSelectorModal';

it('loads the deferred dialog and preserves its dismissal action', async () => {
  const onClose = vi.fn();
  render(<DeferredCryptoSelectorModal selectedCryptoCurrency="USDT" selectedCryptoChain="TRX" isInitializingCrypto={false} onCurrencyChange={vi.fn()} onChainChange={vi.fn()} onInitialize={vi.fn()} onClose={onClose} />);

  expect(await screen.findByRole('dialog', { name: 'Select Crypto Payment' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /close/i }));

  expect(onClose).toHaveBeenCalledTimes(1);
});
