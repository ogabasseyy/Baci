import { describe, expect, it, vi } from 'vitest';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { createSelectWalletHandler } from './utility-wallet-selection';

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

describe('createSelectWalletHandler', () => {
  it('emits paymentMethodSelected telemetry and arms wallet payment', () => {
    // Codex R137 P1: extracted from UtilityModal (300-line ceiling);
    // pins the exact event payload the inline handler sent.
    const setPayWithWallet = vi.fn();

    const handleSelectWallet = createSelectWalletHandler({
      canUseWallet: true,
      customerId: 'customer-1',
      merchantSlug: 'ogabassey',
      setPayWithWallet,
      walletBalance: 500,
    });
    handleSelectWallet();

    expect(captureClientEvent).toHaveBeenCalledWith(
      WALLET_FUNDING_TELEMETRY.events.paymentMethodSelected,
      {
        method: 'wallet',
        wallet_balance: 500,
        can_use_wallet: true,
        merchant_slug: 'ogabassey',
        customer_id: 'customer-1',
      }
    );
    expect(setPayWithWallet).toHaveBeenCalledWith(true);
  });
});
