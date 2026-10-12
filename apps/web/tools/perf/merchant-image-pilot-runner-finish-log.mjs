// Prepared-launch log binding for the bound-evidence runner: profile
// matching, launch-segment slicing, and recorded version/session-time
// parsing. Split from merchant-image-pilot-runner-finish.mjs under the
// repo line ceiling.

// Recorded executable version: the WebDriver session capabilities line,
// either the chromedriver InitSession RESPONSE JSON
// ("browserVersion":"154.0.0.0") or the selenium Caps rendering
// (browserVersion: 154.0.0.0). Dotted quad only — exactly what the
// gate's browser-provenance check accepts. Parsed only inside the
// prepared-profile launch segment (that launch through the next browser
// launch): last match wins within the segment, so the session response
// beats an earlier requested-capabilities line, while a later retry or
// unrelated session can neither supply nor override the version.
const BROWSER_VERSION_PATTERN =
  /(?:"browserVersion"\s*:\s*"(\d+\.\d+\.\d+\.\d+)"|\bbrowserVersion:\s*(\d+\.\d+\.\d+\.\d+))/g;
// Chromedriver epoch-second stamps ([1702635762.891], millis or micros):
// the prepared launch segment's first stamp is the session creation,
// which must precede the bound navigation. Same-process clock as the
// HAR writer, so 1s slack covers read skew without admitting a
// launch-after-navigation swap. Segments without a stamp (selenium
// Caps-style logs) bind version structurally but carry no launch time.
const SESSION_STAMP_PATTERN = /\[(\d+)\.(\d{1,6})\]/;
export const SESSION_NAV_SLACK_MS = 1_000;

function executableVersionFromLog(launchSegment, browserLog) {
  let found;
  for (const match of launchSegment.matchAll(BROWSER_VERSION_PATTERN)) {
    found = match[1] ?? match[2];
  }
  if (found === undefined) {
    throw new Error(
      `prepared-profile launch records no browserVersion (need its WebDriver session-capabilities line); refusing to bind: ${browserLog}`
    );
  }
  return found;
}

// Null when the segment carries no epoch stamp: the caller falls back
// to the reset time for launchedAt and skips the session-ordering
// check, since an unstamped segment cannot establish launch order.
function sessionTimeFromSegment(launchSegment) {
  const stamp = launchSegment.match(SESSION_STAMP_PATTERN);
  if (!stamp) {
    return null;
  }
  return Number(stamp[1]) * 1000 + Number(`${stamp[2]}000`.slice(0, 3));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Binds the log to the prepared profile: exactly one launch with the
// exact profile dir (delimiter-terminated, so a sibling prefix cannot
// satisfy it), sliced through the next browser launch. Returns the
// recorded executable version and session creation time.
export function resolvePreparedLaunch(logText, profileDir, browserLog) {
  const launched = new RegExp(
    `user-data-dir=${escapeRegExp(profileDir)}(?=["'\\s]|$)`,
    'g'
  );
  const launches = logText.match(launched) ?? [];
  if (launches.length === 0) {
    throw new Error(
      `browser log shows no launch with the prepared profile dir (${profileDir}); refusing to bind: ${browserLog}`
    );
  }
  // Exactly one launch: a retry with the same profile dir (warm-up run,
  // then a second run whose single-page HAR is submitted) would
  // otherwise stamp a warm navigation with the reset's cold run id.
  // Together with the single-page HAR rule, one launch means the bound
  // page is that profile's only recorded navigation.
  if (launches.length > 1) {
    throw new Error(
      `browser log shows ${launches.length} launches with the prepared profile dir (${profileDir}); re-prepare instead of binding a possibly warm navigation: ${browserLog}`
    );
  }
  const launchMatch = launched.exec(logText);
  // The segment ends at the next launch on a LATER line: a repeated
  // flag on the launch's own command line must not truncate it.
  const launchLineEnd = logText.indexOf('\n', launchMatch.index);
  const nextLaunchIndex = logText.indexOf(
    'user-data-dir=',
    launchLineEnd === -1
      ? launchMatch.index + launchMatch[0].length
      : launchLineEnd
  );
  const launchSegment = logText.slice(
    launchMatch.index,
    nextLaunchIndex === -1 ? undefined : nextLaunchIndex
  );
  return {
    executableVersion: executableVersionFromLog(launchSegment, browserLog),
    sessionMs: sessionTimeFromSegment(launchSegment),
  };
}
