export function capRemediationCases(cases, maximum) {
  const entries = Object.entries(cases);
  const byNewest = ([, left], [, right]) =>
    String(right.lastSeen || '').localeCompare(String(left.lastSeen || ''));
  const activeDrafts = entries
    .filter(([, item]) => Boolean(item.draftPr))
    .sort(byNewest)
    .slice(0, maximum);
  const activeKeys = new Set(activeDrafts.map(([key]) => key));
  return Object.fromEntries(
    [
      ...activeDrafts,
      ...entries.filter(([key]) => !activeKeys.has(key)).sort(byNewest),
    ].slice(0, maximum)
  );
}
