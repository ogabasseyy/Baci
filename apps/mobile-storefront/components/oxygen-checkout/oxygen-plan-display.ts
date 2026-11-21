import {
  defaultOxygenEquity,
  type OxygenPlanLimits,
  validOxygenPlan,
} from './oxygen-plan';

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
  const minimumEquity = defaultOxygenEquity(limits, tenure);
  const nominalMax =
    Math.floor(
      Math.min(
        90,
        limits.maxEquity,
        (1 - limits.minimumAmount / limits.productAmount) * 100
      ) *
        100 +
        1e-8
    ) / 100;
  // Currency rounds to cents before validation, which can admit one more
  // hundredth of a percentage point than the continuous range suggests.
  const nextPercent = Math.round(nominalMax * 100 + 1) / 100;
  const max = validOxygenPlan(limits, nextPercent, tenure)
    ? nextPercent
    : Math.max(nominalMax, minimumEquity ?? nominalMax);
  const tenures =
    limits.offers?.map((offer) => offer.tenure).sort((a, b) => a - b) ??
    Array.from({ length: months }, (_, i) => i + 1);
  return {
    exceedsOffer,
    unavailable: minimumEquity === null,
    months,
    min: minimumEquity ?? max,
    max,
    tenures,
  };
}
