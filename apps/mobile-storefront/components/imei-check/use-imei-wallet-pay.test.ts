import { renderHook } from '@testing-library/react-native';
import { imeiWalletPayCovers, useImeiWalletPay } from './use-imei-wallet-pay';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/stores/auth-store', () => {
  const state = { user: null, merchantId: null };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

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

describe('bugfix: wallet pay offered for an unavailable or unresolved wallet (Muse)', () => {
  it('holds wallet pay like the checkout transfer does', () => {
    const ready = { balance: 0, primary_balance_kobo: 100_000_000 };
    for (const hold of [
      { primary_unavailable: true },
      { owner_unresolved: true },
    ])
      expect(
        imeiWalletPayCovers({
          canPay: true,
          wallet: { ...ready, ...hold },
          tier: 'basic',
        })
      ).toBe(false);
  });
});

describe('bugfix: a stale balance chose PiggyVest during a refresh (Muse)', () => {
  it('covers nothing while the wallet is re-read, so badge and verify agree', () => {
    const ready = { balance: 0, primary_balance_kobo: 1_000_000 };
    const render = (isRefetching: boolean) =>
      renderHook(() =>
        useImeiWalletPay({
          apiBaseUrl: 'https://api.test',
          device: 'smartphone',
          walletQuery: { data: { wallet: ready }, isRefetching },
          onDelivered: jest.fn(),
          canPay: true,
        })
      ).result.current;
    expect(render(false).covers('basic')).toBe(true);
    const refreshing = render(true);
    expect(refreshing.covers('basic')).toBe(false);
    expect(refreshing.view.covers('basic')).toBe(false);
    expect(refreshing.view.savingsKobo).toBeNull();
  });
});
