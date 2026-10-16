// Runner browser-launch provenance for the pilot effective-settings
// gate: the request User-Agent is emulated configuration, and a bare
// --browser-version string is unbound caller text, so neither proves
// which executable produced the HAR. The runner instead records the
// launch it measured in an artifact the gate binds to the navigation:
//   {"event":"browser-launch","tool":"<runner name>",
//    "runId":"<single-use navigation id>",
//    "executableVersion":"<dotted build>","launchedAt":"<ISO datetime>"}
// One launch certifies exactly one HAR iteration: the runId must equal
// the page's _meta.runId, and the launch must precede the navigation
// by at most one hour (a stale or post-run launch proves nothing about
// this run). Split from the provenance validators under the repo
// ceiling. No I/O, no subprocesses.
import { CLOCK_SKEW_MS } from './merchant-image-pilot-runner-finish.mjs';
import { SESSION_NAV_SLACK_MS } from './merchant-image-pilot-runner-finish-log.mjs';
import { verifyBrowserVersion } from './merchant-image-pilot-settings-browser-version.mjs';

export function verifyBrowserProvenance(text, pages, expectMajor, sourceLabel) {
  if (text === null || text === undefined) {
    return {
      error: `cannot read browser-provenance artifact ${sourceLabel}`,
      ok: false,
    };
  }
  let artifact;
  try {
    artifact = JSON.parse(String(text));
  } catch {
    return {
      error: 'browser-provenance artifact is not valid JSON',
      ok: false,
    };
  }
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    artifact.event !== 'browser-launch' ||
    typeof artifact.tool !== 'string' ||
    artifact.tool.length === 0 ||
    typeof artifact.runId !== 'string' ||
    artifact.runId.length === 0 ||
    artifact.runId.length > 128 ||
    typeof artifact.executableVersion !== 'string' ||
    typeof artifact.launchedAt !== 'string' ||
    !Number.isFinite(Date.parse(artifact.launchedAt))
  ) {
    return {
      error:
        'browser-provenance artifact must be a runner browser-launch record {event, tool, runId, executableVersion, launchedAt}',
      ok: false,
    };
  }
  // The runner flags markerless non-Browsertime binds explicitly: that
  // flag is a refusal, not a warning — a log that cannot show the first
  // navigation cannot certify a cold cache, and a gate that passed it
  // would certify cold on unattested evidence.
  if (artifact.firstNavigationUnverified === true) {
    return {
      error:
        'browser-provenance first navigation is explicitly unverified (markerless log cannot prove a cold cache); re-capture with a navigation-marked verbose log',
      ok: false,
    };
  }
  if (pages?.length > 1) {
    return {
      error: 'one browser launch can certify exactly one HAR iteration',
      ok: false,
    };
  }
  const pageRunId = pages?.[0]?._meta?.runId;
  if (typeof pageRunId !== 'string' || pageRunId.length === 0) {
    return {
      error: 'browser-provenance cannot bind: HAR page carries no _meta.runId',
      ok: false,
    };
  }
  if (pageRunId !== artifact.runId) {
    return {
      error:
        'browser-provenance runId does not match the measured navigation: one launch certifies exactly one navigation',
      ok: false,
    };
  }
  const starts = (pages ?? [])
    .map((page) => Date.parse(page?.startedDateTime))
    .filter(Number.isFinite);
  if (starts.length === 0) {
    return {
      error:
        'browser-provenance cannot bind: HAR pages carry no startedDateTime',
      ok: false,
    };
  }
  const earliest = Math.min(...starts);
  const launchedAt = Date.parse(artifact.launchedAt);
  // Same ordering tolerance finish applies: stamped launches pass
  // finish up to SESSION_NAV_SLACK_MS after the HAR start, and
  // unstamped segments fall back to the reset stamp finish accepts
  // within CLOCK_SKEW_MS. The gate sees only launchedAt, so it takes
  // the max — a launch finish certifies must pass here too.
  if (launchedAt > earliest + Math.max(SESSION_NAV_SLACK_MS, CLOCK_SKEW_MS)) {
    return {
      error: 'browser-provenance launch postdates the measured run',
      ok: false,
    };
  }
  if (earliest - launchedAt > 3_600_000) {
    return {
      error: 'browser-provenance launch is stale (>1h before the measured run)',
      ok: false,
    };
  }
  const checked = verifyBrowserVersion(artifact.executableVersion, expectMajor);
  if (!checked.ok) {
    return checked;
  }
  // Executable product, not just build: chrome-headless-shell reports
  // the same dotted version as full Chrome, so the version check
  // alone would certify shell evidence. The runner records the
  // session-capabilities browserName; shell runs refuse here even
  // when the HAR UA is emulated past the har.browser substring check.
  if (
    typeof artifact.browserName !== 'string' ||
    artifact.browserName.length === 0
  ) {
    return {
      error:
        'browser-provenance artifact records no browserName (need the runner launch record with the session-capabilities browser product)',
      ok: false,
    };
  }
  // Exact product match, not a shell denylist: MicrosoftEdge reports
  // a matching major with an ordinary UA embedding the Chrome token,
  // so headless-shell-only rejection would certify Edge evidence.
  // ChromeDriver reports exactly `chrome` for full Chrome; anything
  // else refuses here. (The HAR check passing Edge is correct — the
  // HAR UA is emulated configuration, not executable identity, which
  // is proven here and by the Lighthouse host UA.)
  if (artifact.browserName.toLowerCase() !== 'chrome') {
    return {
      error: `browser-provenance launch is ${artifact.browserName}, not full Chrome (only full-Chrome evidence can certify the measurement)`,
      ok: false,
    };
  }
  return {
    browserName: artifact.browserName,
    executableVersion: artifact.executableVersion,
    ok: true,
    summary: `${artifact.tool}@${artifact.executableVersion}`,
  };
}
