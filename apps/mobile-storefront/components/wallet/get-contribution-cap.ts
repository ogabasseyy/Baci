export function getContributionCap(available: number, remaining: number) {
  const cap = Math.floor(Math.min(available, remaining));
  return Number.isSafeInteger(cap) && cap > 0 ? cap : 0;
}
