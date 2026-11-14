import { decideImeiVerify } from './decide-imei-verify';

const base = {
  retainedStoreCredit: false,
  retainsPiggyvest: async () => false as boolean | null,
  ownerAtTap: 'user-1' as string | null,
  currentOwner: () => 'user-1' as string | null,
  walletLoading: false,
  walletError: false,
  piggyvestCovers: () => false,
  walletBalance: 0,
  price: 1000,
};

describe('decideImeiVerify', () => {
  it('chooses the rail as before when nothing is kept', async () => {
    await expect(decideImeiVerify(base)).resolves.toEqual({
      kind: 'pay',
      rail: 'top_up',
    });
    await expect(
      decideImeiVerify({ ...base, walletBalance: 1000 })
    ).resolves.toEqual({ kind: 'pay', rail: 'store_credit' });
    await expect(
      decideImeiVerify({ ...base, piggyvestCovers: () => true })
    ).resolves.toEqual({ kind: 'pay', rail: 'piggyvest' });
  });

  it('waits for the wallet, or reports it unavailable, when nothing is kept', async () => {
    await expect(
      decideImeiVerify({ ...base, walletLoading: true })
    ).resolves.toEqual({ kind: 'wait' });
    await expect(
      decideImeiVerify({ ...base, walletError: true })
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('bugfix: replays a kept PiggyVest attempt even when the wallet read failed (Codex P2)', async () => {
    const kept = { ...base, retainsPiggyvest: async () => true };
    await expect(
      decideImeiVerify({ ...kept, walletError: true })
    ).resolves.toEqual({ kind: 'pay', rail: 'piggyvest' });
    await expect(
      decideImeiVerify({ ...kept, walletLoading: true })
    ).resolves.toEqual({ kind: 'pay', rail: 'piggyvest' });
  });

  it('keeps a kept store credit request on store credit', async () => {
    await expect(
      decideImeiVerify({
        ...base,
        retainedStoreCredit: true,
        retainsPiggyvest: async () => true,
        walletBalance: 1000,
      })
    ).resolves.toEqual({ kind: 'pay', rail: 'store_credit' });
  });

  it('bugfix: stops the tap when the account changed while the saved keys were read (Codex P1)', async () => {
    let owner = 'user-1';
    const decision = decideImeiVerify({
      ...base,
      walletBalance: 1000,
      currentOwner: () => owner,
      retainsPiggyvest: async () => {
        owner = 'user-2';
        return false;
      },
    });
    await expect(decision).resolves.toEqual({ kind: 'ignore' });
  });

  it('ignores a tap while another is still checking the saved keys', async () => {
    await expect(
      decideImeiVerify({ ...base, retainsPiggyvest: async () => null })
    ).resolves.toEqual({ kind: 'ignore' });
  });
});

describe('bugfix: a kept store credit request waited for the wallet read (Muse)', () => {
  it('replays a kept store credit request even while the wallet loads or failed', async () => {
    const kept = { ...base, retainedStoreCredit: true };
    await expect(
      decideImeiVerify({ ...kept, walletLoading: true })
    ).resolves.toEqual({ kind: 'pay', rail: 'store_credit' });
    await expect(
      decideImeiVerify({ ...kept, walletError: true })
    ).resolves.toEqual({ kind: 'pay', rail: 'store_credit' });
  });
});
