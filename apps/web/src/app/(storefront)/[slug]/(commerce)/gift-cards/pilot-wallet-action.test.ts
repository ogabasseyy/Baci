import { expect, it, vi } from 'vitest';
import { runPilotWalletAction } from './pilot-wallet-action';

const confirmAuthenticatedGiftCardQuote = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gift-cards/authenticated-wallet', () => ({
  confirmAuthenticatedGiftCardQuote,
  issueAuthenticatedGiftCardQuote: vi.fn(),
}));
vi.mock('@/lib/gift-cards/pilot-wallet-config', () => ({
  getGiftCardPilotConfig: () => ({
    userId: 'fixture-user',
    orderId: 'fixture-order',
    presentationKey: 'fixture-key',
  }),
  PILOT_SUPPLIER_USD: 10.28,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

it('rejects an unconfirmed region before wallet confirmation', async () => {
  const form = new FormData();
  form.set('intent', 'confirm');

  await expect(
    runPilotWalletAction({ status: 'idle' }, form)
  ).resolves.toMatchObject({
    status: 'error',
    message: expect.stringContaining('United States'),
  });
  expect(confirmAuthenticatedGiftCardQuote).not.toHaveBeenCalled();
});
