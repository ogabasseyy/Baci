/** Recognize queries with positive intent for Wi-Fi-only devices, rejecting negations. */
export function hasPositiveWifiOnlyIntent(query: string): boolean {
  // A conservative opt-in: conflicting or negated requests are not permission
  // to recommend restricted devices. No filter or price bound is relaxed.
  if (!/\bwi[\s-]*fi[\s-]*only\b/i.test(query)) {
    return false;
  }
  return !/\b(?:not|no|without|avoid|exclude|excluding|except|non|never|neither|don['’]?t|doesn['’]?t|isn['’]?t|aren['’]?t|but|other\s+than)\b/i.test(
    query
  );
}
