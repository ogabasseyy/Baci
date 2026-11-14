/**
 * How a verify tap pays: a store credit request still holding its key (its
 * answer was lost) always replays on store credit, never forked to the
 * PiggyVest wallet or a top-up; a kept PiggyVest attempt replays there just
 * the same; otherwise PiggyVest when it covers the check,
 * a top-up when store credit is short, else store credit.
 */
export function chooseImeiPaymentRail(input: {
  retainedStoreCredit: boolean;
  /** An earlier PiggyVest attempt is kept: it replays there (Codex P1). */
  retainedPiggyvest?: boolean;
  piggyvestCovers: boolean;
  walletBalance: number;
  price: number;
}): 'store_credit' | 'piggyvest' | 'top_up' {
  if (input.retainedStoreCredit) return 'store_credit';
  if (input.retainedPiggyvest || input.piggyvestCovers) return 'piggyvest';
  return input.walletBalance < input.price ? 'top_up' : 'store_credit';
}
