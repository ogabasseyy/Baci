import { expect, it, vi } from 'vitest';
import { confirmGiftCardPurchase } from './checkout';
import { createMockGiftCardWallet } from './mock-wallet';

const quote = {
  id: 'quote-1',
  cardId: '3007',
  totalKobo: 1025634,
  expiresAt: 10_000,
};

it('charges the displayed price once and submits once on concurrent confirmation', async () => {
  const wallet = createMockGiftCardWallet(2_000_000);
  const submit = vi.fn().mockResolvedValue({ orderId: 'order-1' });
  const checkout = () =>
    confirmGiftCardPurchase(quote, wallet, submit, () => 100);
  const [first] = await Promise.all([checkout(), checkout()]);
  expect(first).toMatchObject({ status: 'submitted', orderId: 'order-1' });
  expect(await checkout()).toEqual(first);
  expect(wallet.balance()).toBe(974366);
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    cardId: '3007',
    reference: 'quote-1',
  });
});

it('never debits or sends an expired quote or a quote with insufficient funds', async () => {
  const wallet = createMockGiftCardWallet(500);
  const submit = vi.fn();
  expect(
    await confirmGiftCardPurchase(quote, wallet, submit, () => 10_000)
  ).toEqual({ status: 'expired' });
  expect(
    await confirmGiftCardPurchase(quote, wallet, submit, () => 100)
  ).toEqual({ status: 'insufficient' });
  expect(wallet.balance()).toBe(500);
  expect(submit).not.toHaveBeenCalled();
});

it('preserves an uncertain submission for reconciliation without replay or refund', async () => {
  const wallet = createMockGiftCardWallet(2_000_000);
  const submit = vi.fn().mockRejectedValue(new Error('timed out'));
  const checkout = () =>
    confirmGiftCardPurchase(quote, wallet, submit, () => 100);
  expect(await checkout()).toEqual({ status: 'unknown' });
  expect(await checkout()).toEqual({ status: 'unknown' });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(wallet.balance()).toBe(974366);
});
