import { imeiWalletPayCovers } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// basic tier: ₦300 (see @baci/shared/imei).
describe('imeiWalletPayCovers', () => {
  const ready = { balance: 0, primary_balance_kobo: 1_000_000 };

  it('pays from the PiggyVest wallet when store credit is short and PiggyVest covers it', () => {
    expect(
      imeiWalletPayCovers({ canPay: true, wallet: ready, tier: 'basic' })
    ).toBe(true);
  });

  it('keeps store credit first whenever it covers the check', () => {
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: { ...ready, balance: 100_000 },
        tier: 'basic',
      })
    ).toBe(false);
  });

  it('does not offer it when the PiggyVest wallet is short too', () => {
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: { balance: 0, primary_balance_kobo: 100 },
        tier: 'basic',
      })
    ).toBe(false);
  });

  it('does not offer it to customers who are not PiggyVest-ready', () => {
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: { balance: 0 },
        tier: 'basic',
      })
    ).toBe(false);
    expect(
      imeiWalletPayCovers({ canPay: true, wallet: null, tier: 'basic' })
    ).toBe(false);
  });
});

describe('bugfix: wallet pay offered where the server refuses it (Codex P2)', () => {
  const ready = { balance: 0, primary_balance_kobo: 100_000_000 };

  it('never offers Petrock-only checks', () => {
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: ready,
        tier: 'esimCompatibility',
      })
    ).toBe(false);
  });

  it('never trusts a remembered or pending PiggyVest balance', () => {
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: { ...ready, primary_stale: true },
        tier: 'basic',
      })
    ).toBe(false);
    expect(
      imeiWalletPayCovers({
        canPay: true,
        wallet: { ...ready, primary_pending: true },
        tier: 'basic',
      })
    ).toBe(false);
  });
});
