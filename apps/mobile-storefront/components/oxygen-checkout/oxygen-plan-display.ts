import { defaultOxygenEquity, type OxygenPlanLimits } from './oxygen-plan';

export function oxygenPlanDisplay(
  limits: OxygenPlanLimits,
  equity: number,
  tenure: number
) {
  const selectedOffer = limits.offers?.find((offer) => offer.tenure === tenure);
  const exceedsOffer = Boolean(
    selectedOffer &&
      (limits.productAmount * (100 - equity)) / 100 > selectedOffer.loanAmount
  );
  const months = limits.offers?.length
    ? Math.max(...limits.offers.map((offer) => offer.tenure))
    : Math.max(0, Math.min(12, Math.floor(limits.maxTenure)));
  const min =
    Math.ceil(
      Math.max(
        25,
        limits.minEquity,
        (1 - limits.eligibleAmount / limits.productAmount) * 100
      ) *
        100 -
        1e-8
    ) / 100;
  const max =
    Math.floor(
      Math.min(
        90,
        limits.maxEquity,
        (1 - limits.minimumAmount / limits.productAmount) * 100
      ) *
        100 +
        1e-8
    ) / 100;
  const tenures =
    limits.offers?.map((offer) => offer.tenure).sort((a, b) => a - b) ??
    Array.from({ length: months }, (_, i) => i + 1);
  const unavailable =
    !!limits.offers && defaultOxygenEquity(limits, tenure) === null;
  return { exceedsOffer, unavailable, months, min, max, tenures };
}
