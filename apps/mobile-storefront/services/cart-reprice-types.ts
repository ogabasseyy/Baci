import type {
  CartConditionChange,
  CartOfferAdoption,
  CartPriceChange,
  CartUnavailableLine,
} from './cart-reprice-offer-lines';

export type {
  CartConditionChange,
  CartOfferAdoption,
  CartPriceChange,
  CartUnavailableLine,
};

export interface RepriceResult {
  /** Live unit price keyed by cart line id (only lines we could resolve). */
  priceById: Record<string, number>;
  /**
   * Live condition keyed by cart line id, for resolved offer lines whose
   * submitted condition drifted from the live offer row. Applied together
   * with the price so checkout no longer rejects the stale condition.
   */
  conditionById: Record<string, string>;
  /** Lines whose extended line total drifted beyond tolerance. */
  changes: CartPriceChange[];
  /**
   * Lines whose offer condition drifted without a price move. Tracked
   * separately from price changes so a condition-only refresh does not
   * render as a bogus "X to X" price move.
   */
  conditionChanges: CartConditionChange[];
  /** Lines whose row vanished after a successful lookup. Failed lookups
   * fail open and never land here; checkout must stop for these. */
  unavailable: CartUnavailableLine[];
  /**
   * Adopted exact offer ids for legacy offerless lines, keyed by cart
   * line id. The adopted line reprices from the live offer row like an
   * exact offer line, so checkout accepts it.
   */
  offerIdById: Record<string, string>;
  /** Legacy lines that adopted an unambiguous live offer this round. */
  adoptions: CartOfferAdoption[];
}

export const EMPTY_REPRICE_RESULT: RepriceResult = {
  priceById: {},
  conditionById: {},
  changes: [],
  conditionChanges: [],
  unavailable: [],
  offerIdById: {},
  adoptions: [],
};
