import type { OxygenApprovalCodeWindow } from '@baci/shared/oxygen';
export interface OxygenPlanLimits {
  productAmount: number;
  eligibleAmount: number;
  minimumAmount: number;
  maxTenure: number;
  minEquity: number;
  maxEquity: number;
  offers?: { tenure: number; loanAmount: number }[];
}
export interface OxygenConfirmedTerms {
  reference: string;
  upfront: number;
  monthly: number;
  charges: number;
  schedule: { period: number; date: string; amount: number }[];
}
export function validOxygenPlan(
  limits: OxygenPlanLimits,
  equity: number,
  tenure: number
): boolean {
  const total = Math.round(limits.productAmount * 100);
  const down = Math.round((total * Math.round(equity * 100)) / 10000);
  const financed = (total - down) / 100;
  const offer = limits.offers?.find((item) => item.tenure === tenure);
  return (
    [
      limits.productAmount,
      limits.eligibleAmount,
      limits.minimumAmount,
      limits.maxTenure,
      limits.minEquity,
      limits.maxEquity,
    ].every(Number.isFinite) &&
    Number.isSafeInteger(total) &&
    Number.isSafeInteger(total * Math.round(equity * 100)) &&
    limits.productAmount > 0 &&
    limits.minimumAmount > 0 &&
    Number.isInteger(tenure) &&
    tenure >= 1 &&
    tenure <= Math.min(12, limits.maxTenure) &&
    /^\d+(?:\.\d{1,2})?$/.test(String(equity)) &&
    equity >= Math.max(25, limits.minEquity) &&
    equity <= Math.min(90, limits.maxEquity) &&
    financed >= limits.minimumAmount &&
    financed <= limits.eligibleAmount &&
    (limits.offers === undefined || (!!offer && financed <= offer.loanAmount))
  );
}
export function defaultOxygenEquity(
  limits: OxygenPlanLimits,
  tenure = 1
): number | null {
  const offer = limits.offers?.find((item) => item.tenure === tenure);
  if (limits.offers && !offer) return null;
  const equity =
    Math.ceil(
      Math.max(
        25,
        limits.minEquity,
        (1 -
          Math.min(
            limits.eligibleAmount,
            offer?.loanAmount ?? limits.eligibleAmount
          ) /
            limits.productAmount) *
          100
      ) *
        100 -
        1e-8
    ) / 100;
  // Check the adjacent lower value against the same rounded cents as booking.
  const lower = Math.round(equity * 100 - 1) / 100;
  if (validOxygenPlan(limits, lower, tenure)) return lower;
  if (validOxygenPlan(limits, equity, tenure)) return equity;
  const next = Math.round(equity * 100 + 1) / 100;
  return validOxygenPlan(limits, next, tenure) ? next : null;
}
/** Reference and confirmed monetary schedule scope transient consent; never persist it. */
export function oxygenTermsKey(terms: OxygenConfirmedTerms): string {
  return JSON.stringify([
    terms.reference,
    terms.upfront,
    terms.monthly,
    terms.charges,
    terms.schedule.map((row) => [row.period, row.date, row.amount]),
  ]);
}
export function canApproveOxygen(input: {
  reference: string;
  termsKey: string;
  capturedTermsKey: string | null;
  signature: boolean;
  accepted: boolean;
  window: OxygenApprovalCodeWindow | null;
  now: number;
  pending: 'queued' | 'executing' | 'indeterminate' | null;
}): boolean {
  const window = input.window;
  return (
    input.pending === null &&
    input.signature &&
    input.accepted &&
    input.termsKey === input.capturedTermsKey &&
    !!window &&
    window.bookingReference === input.reference &&
    Number.isFinite(input.now) &&
    Date.parse(window.sentAt) <= input.now &&
    Date.parse(window.expiresAt) > input.now &&
    Date.parse(window.expiresAt) - Date.parse(window.sentAt) === 300000
  );
}
