// The one place that decides whether a run may start the heavy (full) CI stage.
// Pure: every fact is passed in, so every branch is unit-tested.
//
//   stage 'full'  run everything, required jobs keep their real names
//   stage 'quick' run only the quick checks; Build / Quality Gate stay deferred
//
// Order matters and is fail-closed: the first matching rule wins.

export const BREAK_GLASS_LABEL = 'ci-now';
export const PILOT_LABEL = 'review-first-ci';
// How long a pull request waits for a Codex verdict before the full CI starts anyway. THE one
// place to change the default; the repository variable BACI_CODEX_WAIT_TIMEOUT_MINUTES overrides
// it without a code change. Codex normally answers in 2 to 10 minutes (observed 2026-11-11), so 30
// leaves a wide margin while keeping a Codex outage from holding pull requests for long.
export const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_TIMEOUT_MINUTES = 1440;
// The sweep must still see a run after the timeout has passed: the timeout, the nudge's
// 2 minute margin and a couple of quarter-hourly sweeps.
const SWEEP_MARGIN_MINUTES = 150;
const MIN_SWEEP_LOOKBACK_MINUTES = 360;

// One parser for the no-verdict timeout, used by the `changes` job and by the nudge, so the
// two can never disagree about it. Anything but a positive whole number means the default.
export function parseTimeoutMinutes(value) {
  if (!/^\d+$/.test(String(value ?? '').trim())) return DEFAULT_TIMEOUT_MINUTES;
  const minutes = Number.parseInt(String(value).trim(), 10);
  return minutes > 0 ? Math.min(minutes, MAX_TIMEOUT_MINUTES) : DEFAULT_TIMEOUT_MINUTES;
}

export function sweepLookbackMs(timeoutMinutes) {
  return Math.max(MIN_SWEEP_LOOKBACK_MINUTES, timeoutMinutes + SWEEP_MARGIN_MINUTES) * 60000;
}

// GitHub expressions compare strings case-insensitively, so the workflow treats `ON` like `on`;
// this keeps the script in step with them.
export const normalizeMode = (mode) => String(mode ?? '').trim().toLowerCase();

const result = (stage, code, reason, warn = false) => ({ stage, code, reason, warn });

export function decideStage(input) {
  const {
    eventName,
    mode: rawMode,
    sameRepo,
    // undefined = the labels could not be read (not the same as "no labels")
    labels,
    draft = false,
    open = true,
    headSha,
    liveHeadSha,
    verdict,
    ageMinutes = 0,
    timeoutMinutes = DEFAULT_TIMEOUT_MINUTES,
    apiError = null,
  } = input;
  const mode = normalizeMode(rawMode);

  if (eventName !== 'pull_request') return result('full', 'not-pull-request', `${eventName} events always run the full CI`);
  if (!sameRepo) return result('full', 'fork', 'pull requests from forks keep the full CI');
  if (mode !== 'on' && mode !== 'pilot') return result('full', 'mode-off', 'review-first CI is switched off (BACI_REVIEW_FIRST_CI)');
  const labelsKnown = Array.isArray(labels);
  if (mode === 'pilot' && labelsKnown && !labels.includes(PILOT_LABEL)) {
    return result('full', 'pilot-not-selected', `pilot mode: this pull request does not carry the "${PILOT_LABEL}" label`);
  }

  if (!open) return result('quick', 'closed', 'the pull request is no longer open');
  if (liveHeadSha && headSha && liveHeadSha !== headSha) {
    return result('quick', 'superseded', `the pull request head moved to ${liveHeadSha.slice(0, 7)}; this run is for ${headSha.slice(0, 7)}`);
  }
  if (labelsKnown && labels.includes(BREAK_GLASS_LABEL)) return result('full', 'break-glass', `the "${BREAK_GLASS_LABEL}" label asks for the full CI now`, true);

  if (verdict?.state === 'clean') return result('full', 'codex-clean', verdict.reason);
  if (verdict?.state === 'findings') return result('quick', 'codex-findings', `${verdict.reason}; fix them or add the "${BREAK_GLASS_LABEL}" label`);

  const waitedLongEnough = !draft && ageMinutes >= timeoutMinutes;
  if (waitedLongEnough && (apiError || verdict?.state === 'none' || verdict?.state === 'running')) {
    return result('full', 'timeout', `no Codex verdict after ${Math.floor(ageMinutes)} minutes (limit ${timeoutMinutes}): starting the full CI anyway`, true);
  }
  if (apiError) {
    return result('quick', 'api-error', `could not read the Codex verdict (${apiError}); failing closed, quick checks only`, true);
  }
  const unrecognized = verdict?.unrecognized ?? [];
  if (unrecognized.length > 0) {
    return result('quick', 'waiting', `Codex wrote items that are not understood (${unrecognized.join('; ')}); failing closed. ${verdict.reason}`, true);
  }
  return result('quick', 'waiting', verdict?.reason ?? 'no Codex verdict yet');
}
