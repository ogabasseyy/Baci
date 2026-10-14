// Network-level image purity for the merchant image pilot readiness
// gate: every fetched image URL must come from the approved mount
// identities or the frozen filler/icon sets. Per-image verdicts pin the
// bound slots, but only this catches an EXTRA unmarked fetch. Split from
// merchant-image-pilot-readiness-checks.mjs under the repo line ceiling.
export function servedPathname(currentSrc) {
  try {
    return new URL(currentSrc).pathname;
  } catch {
    return String(currentSrc ?? '').split('?')[0];
  }
}

// Frozen grid-filler pathnames, mirrored from PILOT_LAB_FILLER_IMAGES in
// lab-fixtures.ts (this gate module cannot import the app's TS fixture
// layer; the purity suite pins them equal by source text). Fillers render
// identically in both arms: the only non-mount page images a surface may
// fetch.
const PILOT_FILLER_PATHNAMES = new Set([
  '/__pilot/fillers/grid-filler-600x400-a.png',
  '/__pilot/fillers/grid-filler-600x400-b.png',
  '/__pilot/fillers/grid-filler-600x400-c.png',
]);

// Browser-automatic icon fetches, not page content: the root layout's
// rel=icon candidates (Chromium picks among them version-dependently)
// plus the /favicon.ico fallback. Exact committed pathnames — if the
// layout's icons change, the gate fails loudly until this set follows,
// rather than silently admitting new bytes. Manifest and apple-touch
// icons are not load-time fetches and stay excluded.
const BROWSER_ICON_PATHNAMES = new Set([
  '/baci-verified-favicon.svg',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/favicon.ico',
]);

export function pilotImageUrlViolation(urls, allowedTierPathnames) {
  // Exact tier allowlist, not a generation prefix: a mismatched preload
  // fetching one tier while the rendered image selects another would
  // pass a prefix check while its extra bytes and connection contention
  // corrupt the control/pilot comparison. The caller builds the set
  // from the decoded selected/slot currentSrc values (collection
  // captures currentSrc unconditionally, including hidden imgs).
  const allowed = new Set(allowedTierPathnames);
  return urls.find((url) => {
    const pathname = servedPathname(url);
    if (
      PILOT_FILLER_PATHNAMES.has(pathname) ||
      BROWSER_ICON_PATHNAMES.has(pathname)
    ) {
      return false;
    }
    return !allowed.has(pathname);
  });
}

// Multiplicity twin: the same tier fetched twice doubles its bytes and
// contention. Fillers/icons are exempt (frozen sets shared across cards;
// a duplicate there is browser behavior noise, not measurement skew).
export function duplicateImageUrlViolation(urls) {
  const seen = new Set();
  return urls.find((url) => {
    const pathname = servedPathname(url);
    if (
      PILOT_FILLER_PATHNAMES.has(pathname) ||
      BROWSER_ICON_PATHNAMES.has(pathname)
    ) {
      return false;
    }
    if (seen.has(pathname)) {
      return true;
    }
    seen.add(pathname);
    return false;
  });
}

export function controlImageUrlViolation(urls, stagedOriginals) {
  const allowed = new Set(stagedOriginals);
  return urls.find((url) => {
    const pathname = servedPathname(url);
    return (
      !PILOT_FILLER_PATHNAMES.has(pathname) &&
      !BROWSER_ICON_PATHNAMES.has(pathname) &&
      !allowed.has(pathname)
    );
  });
}

export function pilotImageUrlsOk(urls, allowedTierPathnames) {
  return pilotImageUrlViolation(urls, allowedTierPathnames) === undefined;
}

export function controlImageUrlsOk(urls, stagedOriginals) {
  return controlImageUrlViolation(urls, stagedOriginals) === undefined;
}
