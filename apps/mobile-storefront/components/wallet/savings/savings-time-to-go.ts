/** Days up to six months, then months, then years past two years. */
export function timeToGo(days: number) {
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (days <= 180) return plural(days, 'day');
  if (days < 730) return plural(Math.round(days / 30.44), 'month');
  return plural(Math.round(days / 365.25), 'year');
}

/** A plan longer than this (two years) gets a nudge to save more each time. */
export const LONG_PLAN_DAYS = 730;
