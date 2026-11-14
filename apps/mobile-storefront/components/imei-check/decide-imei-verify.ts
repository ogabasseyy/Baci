import { chooseImeiPaymentRail } from './choose-imei-payment-rail';

export type ImeiVerifyDecision =
  /** Another verify tap is still checking: this one is ignored. */
  | { kind: 'ignore' }
  /** The wallet is loading or being re-read: try again in a moment. */
  | { kind: 'wait' }
  /** The wallet could not be read. */
  | { kind: 'unavailable' }
  | { kind: 'pay'; rail: 'store_credit' | 'piggyvest' | 'top_up' };

/**
 * How a verify tap goes on. A kept PiggyVest attempt (its answer was lost)
 * is looked for first and replays before the wallet read is consulted: its
 * recovery needs no balance, so a failed wallet read never withholds an
 * already-paid check (Codex P2). The signed-in account is checked again
 * after that await: a switch while the saved keys were read stops the tap,
 * so nothing is paid or shown for the wrong account (Codex P1).
 */
export async function decideImeiVerify(input: {
  retainedStoreCredit: boolean;
  retainsPiggyvest: () => Promise<boolean | null | 'unreadable'>;
  ownerAtTap: string | null;
  currentOwner: () => string | null;
  walletLoading: boolean;
  walletError: boolean;
  piggyvestCovers: () => boolean;
  walletBalance: number;
  price: number;
}): Promise<ImeiVerifyDecision> {
  const retainedPiggyvest = await input.retainsPiggyvest();
  if (retainedPiggyvest === null) return { kind: 'ignore' };
  if (input.currentOwner() !== input.ownerAtTap) return { kind: 'ignore' };
  // A kept attempt of either rail replays on that rail before the wallet
  // read is consulted: neither replay needs the balance (Muse). A store
  // credit request still holding its key wins.
  if (input.retainedStoreCredit) return { kind: 'pay', rail: 'store_credit' };
  if (retainedPiggyvest === true) return { kind: 'pay', rail: 'piggyvest' };
  // The saved keys could not be read: they may hide a payment still
  // settling, so no other rail is chosen on a guess (Codex P1).
  if (retainedPiggyvest === 'unreadable') return { kind: 'unavailable' };
  if (input.walletLoading) return { kind: 'wait' };
  if (input.walletError) return { kind: 'unavailable' };
  return {
    kind: 'pay',
    rail: chooseImeiPaymentRail({
      retainedStoreCredit: false,
      retainedPiggyvest: false,
      piggyvestCovers: input.piggyvestCovers(),
      walletBalance: input.walletBalance,
      price: input.price,
    }),
  };
}
