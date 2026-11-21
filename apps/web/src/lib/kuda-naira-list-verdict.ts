/**
 * The purchase API rejects any amount under ₦50 (schemas/vtu.ts), so a fixed
 * price below that is never sold. In a list priced in kobo none exists (the
 * cheapest production price is exactly ₦50, i.e. 5000 kobo).
 */
const MIN_SELLABLE_PRICE_KOBO = 5000;
/**
 * Fewer fixed prices than this give too little evidence to tell kobo from
 * naira: one package sent as 5000 (naira) reads as ₦50 and passes every other
 * check. Such an answer is refused too, the money-safe direction. No live
 * production answer is that small (the smallest fixed-price answers are cable
 * with 40 prices and data with 243), and open-amount items are not counted, so
 * airtime, betting and electricity (meter products included) are unaffected.
 */
const MIN_FIXED_PRICES_TO_JUDGE = 5;
/**
 * Share of fixed prices under the floor that marks the whole answer as naira.
 * A kobo list has none; a naira list read as kobo has about half (production
 * data bundles 52%, cable packages 43%), so this separates them widely.
 */
const NAIRA_LIST_SHARE = 0.1;

/**
 * Whether a Kuda answer looks like it was really priced in naira: a large
 * share of its fixed prices, read as kobo, land under the ₦50 purchase floor
 * (a naira list read as kobo comes out 100x too low). It judges the whole
 * answer, so it works whatever the item names say and whichever billers
 * happen to list a cheap item.
 */
export function looksLikeNairaPricedList(rawFixedPricesKobo: number[]): {
  belowFloor: number;
  fixedPrices: number;
  isNaira: boolean;
  /** Some fixed prices, but too few to establish the unit. */
  tooFewToJudge: boolean;
} {
  const belowFloor = rawFixedPricesKobo.filter(
    (price) => price < MIN_SELLABLE_PRICE_KOBO
  ).length;
  const fixedPrices = rawFixedPricesKobo.length;
  return {
    belowFloor,
    fixedPrices,
    isNaira:
      fixedPrices >= MIN_FIXED_PRICES_TO_JUDGE &&
      belowFloor / fixedPrices >= NAIRA_LIST_SHARE,
    tooFewToJudge: fixedPrices > 0 && fixedPrices < MIN_FIXED_PRICES_TO_JUDGE,
  };
}
