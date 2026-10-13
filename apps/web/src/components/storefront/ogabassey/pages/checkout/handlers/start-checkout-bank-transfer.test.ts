import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { isEligibleForWalletFundedBankTransfer } from '../wallet-funded-transfer-eligibility';
import { paymentDispatchContext } from './checkout-payment-dispatch-context.test-support';
import { initializeCheckoutDva } from './initialize-checkout-dva';
import { startCheckoutBankTransfer } from './start-checkout-bank-transfer';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/config/wallet-order-auto-debit', () => ({
  isWalletOrderAutoDebitWebEnabled: () => true,
}));
vi.mock('../wallet-funded-transfer-eligibility', () => ({
  isEligibleForWalletFundedBankTransfer: vi.fn(),
}));
vi.mock('./initialize-checkout-dva', () => ({
  initializeCheckoutDva: vi.fn(),
}));

describe('startCheckoutBankTransfer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isEligibleForWalletFundedBankTransfer).mockReturnValue(true);
  });
  it('awaits session resolution before attempting wallet funding', async () => {
    const context = paymentDispatchContext();
    context.waitForResolvedStorefrontCustomerAuth = vi.fn(async () => {
      expect(context.walletFundedTransfer.start).not.toHaveBeenCalled();
      return true;
    });
    await startCheckoutBankTransfer(context);
    expect(isEligibleForWalletFundedBankTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ isAuthenticated: true })
    );
    expect(initializeCheckoutDva).toHaveBeenCalledOnce();
  });
  it('uses DVA directly when wallet funding is ineligible', async () => {
    vi.mocked(isEligibleForWalletFundedBankTransfer).mockReturnValue(false);
    const context = paymentDispatchContext();
    await startCheckoutBankTransfer(context);
    expect(context.walletFundedTransfer.start).not.toHaveBeenCalled();
    expect(initializeCheckoutDva).toHaveBeenCalledOnce();
  });
  it('keeps an uncertain wallet attempt from opening a second funding channel', async () => {
    const context = paymentDispatchContext();
    vi.mocked(context.walletFundedTransfer.start).mockResolvedValue(
      'uncertain'
    );
    await startCheckoutBankTransfer(context);
    expect(initializeCheckoutDva).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'We could not confirm your transfer setup',
      })
    );
    expect(context.isOrderInFlightRef.current).toBe(false);
    expect(context.clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });
  it('records a started intent without falling through to DVA', async () => {
    const context = paymentDispatchContext();
    vi.mocked(context.walletFundedTransfer.start).mockResolvedValue({
      status: 'started',
      intentId: 'intent-1',
    });
    await startCheckoutBankTransfer(context);
    expect(context.capturePaymentStarted).toHaveBeenCalledWith('intent-1');
    expect(initializeCheckoutDva).not.toHaveBeenCalled();
    expect(context.isOrderInFlightRef.current).toBe(false);
  });
  it('propagates session lookup errors without starting a payment', async () => {
    const context = paymentDispatchContext();
    vi.mocked(context.waitForResolvedStorefrontCustomerAuth).mockRejectedValue(
      new Error('session failed')
    );
    await expect(startCheckoutBankTransfer(context)).rejects.toThrow(
      'session failed'
    );
    expect(context.walletFundedTransfer.start).not.toHaveBeenCalled();
    expect(initializeCheckoutDva).not.toHaveBeenCalled();
  });
});
