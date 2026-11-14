import { getContributionCap } from './get-contribution-cap';

const MODEST_DEFAULT = 1000;

/** Suggest a modest amount; spending the full available balance is opt-in. */
export function getDefaultContributionAmount({
  available,
  remaining,
}: {
  available: number;
  remaining: number;
}) {
  return Math.min(MODEST_DEFAULT, getContributionCap(available, remaining));
}
