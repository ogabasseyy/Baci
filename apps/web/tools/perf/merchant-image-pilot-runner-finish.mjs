// Finish phase of the bound-evidence runner: stamp the run id into a
// COPY of the HAR (the raw export is never mutated), bind the
// screenshot by its OS-recorded mtime, and emit the screenshot-capture
// and browser-launch records. Split from
// merchant-image-pilot-runner.mjs under the repo line ceiling; capture
// validation lives in merchant-image-pilot-runner-finish-capture.mjs
// and atomic publication in
// merchant-image-pilot-runner-finish-publish.mjs.
//
// Trust model: the HAR, log, and screenshot are operator-supplied
// artifacts. Finish checks their mutual consistency (single launch,
// single page, recorded version/session binding, time windows, PNG
// geometry) and freezes the bound set for audit — it cannot prove a
// malicious operator captured them honestly (mtime and file bytes are
// equally forgeable), only refuse the inconsistent and the stale.
// Capture authenticity is an operator responsibility, same as HAR
// authorship; the recorded hashes freeze the pair the operator chose.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  MAX_BROWSER_LOG_BYTES,
  MAX_HAR_BYTES,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readUpToBytes } from './merchant-image-pilot-preflight-shared.mjs';
import { bindScreenshotCapture } from './merchant-image-pilot-runner-finish-capture.mjs';
import {
  resolvePreparedLaunch,
  SESSION_NAV_SLACK_MS,
} from './merchant-image-pilot-runner-finish-log.mjs';
import { publishBoundSet } from './merchant-image-pilot-runner-finish-publish.mjs';

const PROVENANCE_WINDOW_MS = 3_600_000;

// Same-machine clock/granularity slack for the run-window bounds. The
// capture-vs-navigation bound takes none: it mirrors the gate's strict
// capturedAt check exactly, so finish refuses what the gate would fail.
const CLOCK_SKEW_MS = 5_000;

export function required(value, flag) {
  if (value === undefined || value === '') {
    throw new Error(`missing required --${flag}`);
  }
  return value;
}

export async function finishRun({
  browserLog,
  har,
  io = {},
  outDir,
  runJson,
  screenshot,
}) {
  const handleRead = await readUpToBytes(required(runJson, 'run-json'), 65536);
  const handle = JSON.parse(handleRead.bytes.toString('utf8'));
  if (typeof handle?.runId !== 'string' || handle.runId.length === 0) {
    throw new Error(`run handle has no run id: ${runJson}`);
  }
  if (typeof handle.profileDir !== 'string' || handle.profileDir.length === 0) {
    throw new Error(`run handle has no prepared profile dir: ${runJson}`);
  }
  // Session geometry, not finish flags: prepare attests the pair once
  // beside the profile it mints, and finish derives it from this same
  // handle — a second attestation here would let a same-product pair
  // slip in between prepare and finish. Handles minted before the
  // session record carried geometry cannot finish; re-prepare.
  const sessionViewport = handle.viewport;
  if (
    !sessionViewport ||
    !Number.isInteger(sessionViewport.width) ||
    sessionViewport.width < 1 ||
    !Number.isInteger(sessionViewport.height) ||
    sessionViewport.height < 1
  ) {
    throw new Error(
      `run handle has no session viewport (re-prepare with --viewport): ${runJson}`
    );
  }
  if (
    typeof handle.deviceScaleFactor !== 'number' ||
    !Number.isFinite(handle.deviceScaleFactor) ||
    handle.deviceScaleFactor <= 0
  ) {
    throw new Error(
      `run handle has no session deviceScaleFactor (re-prepare with --dpr): ${runJson}`
    );
  }
  // Profile binding: the browser's recorded command line (Browsertime
  // --verbose log) must show exactly one launch with the exact prepared
  // profile dir, and the recorded version/session bind to that launch's
  // segment only. Fail fast, before writing anything: without recorded
  // values the launch record would carry caller text the gate cannot
  // trust.
  const logRead = await readUpToBytes(
    required(browserLog, 'browser-log'),
    MAX_BROWSER_LOG_BYTES
  );
  if (logRead.truncated) {
    throw new Error(
      `browser log exceeds ${MAX_BROWSER_LOG_BYTES} bytes: ${browserLog}`
    );
  }
  const { executableVersion, navigationCount, sessionMs } =
    resolvePreparedLaunch(
      logRead.bytes.toString('utf8'),
      handle.profileDir,
      browserLog
    );
  const out = required(outDir, 'out-dir');
  await mkdir(out, { recursive: true });
  // One reset certifies exactly one navigation: multi-page HARs (repeat
  // views, multi-step flows) cannot bind to a single run id.
  const harRead = await readUpToBytes(required(har, 'har'), MAX_HAR_BYTES);
  if (harRead.truncated) {
    throw new Error(`HAR exceeds ${MAX_HAR_BYTES} bytes: ${har}`);
  }
  const harJson = JSON.parse(harRead.bytes.toString('utf8'));
  const pages = harJson?.log?.pages;
  if (!Array.isArray(pages) || pages.length !== 1) {
    throw new Error(
      `HAR must hold exactly one page to bind (found ${Array.isArray(pages) ? pages.length : 'none'}): ${har}`
    );
  }
  const [page] = pages;
  // A Browsertime HAR without a logged navigation cannot bind: that
  // driver always records its navigations, so a markerless log for its
  // HAR cannot rule out a warmed retry submitted as cold. Other
  // drivers' markerless segments bind with the launch record flagged
  // below (the Caps contract), never silently.
  const harCreator = String(harJson?.log?.creator?.name ?? '').toLowerCase();
  if (navigationCount === 0 && harCreator === 'browsertime') {
    throw new Error(
      `Browsertime HAR binds only with its verbose navigation record (found no 'Navigating to' line): ${browserLog}`
    );
  }
  const startedMs = Date.parse(page?.startedDateTime ?? '');
  if (!Number.isFinite(startedMs)) {
    throw new Error(`HAR page has no usable startedDateTime: ${har}`);
  }
  const nowMs = Date.now();
  if (startedMs > nowMs) {
    throw new Error(
      `HAR page starts in the future (clock skew): ${page.startedDateTime}`
    );
  }
  if (nowMs - startedMs > PROVENANCE_WINDOW_MS) {
    throw new Error(
      `HAR page is older than one hour; re-run the navigation instead of binding stale evidence: ${har}`
    );
  }
  // Never rebind another run's evidence; re-finishing the same run is
  // idempotent (same stamp, fresh capture record).
  const stamped = page._meta?.runId;
  if (stamped !== undefined && stamped !== handle.runId) {
    throw new Error(`HAR page is already bound to run ${stamped}: ${har}`);
  }
  page._meta = { ...(page._meta ?? {}), runId: handle.runId };
  // The reset record doubles as the run's lower time bound: both the HAR
  // navigation and the screenshot capture must fall after it.
  const resetSource = join(dirname(runJson), 'profile-reset.json');
  const resetRead = await readUpToBytes(resetSource, 64 * 1024).catch(() => {
    throw new Error(`run handle has no profile-reset record: ${resetSource}`);
  });
  const reset = JSON.parse(resetRead.bytes.toString('utf8'));
  // Bind the reset to THIS run: the record sits beside run.json, so a
  // sibling file from a different prepare invocation must not certify
  // this handle's lower time bound. The settings gate rejects the
  // cross-run bundle later, which would strand a "successful" capture.
  if (reset?.event !== 'profile-reset' || reset?.freshProfile !== true) {
    throw new Error(
      `profile-reset record is not a fresh-profile reset event: ${resetSource}`
    );
  }
  for (const [field, expected, actual] of [
    ['runId', handle.runId, reset?.runId],
    ['profileDir', handle.profileDir, reset?.profileDir],
    ['tool', handle.tool, reset?.tool],
  ]) {
    if (actual !== expected) {
      throw new Error(
        `profile-reset record belongs to a different run (${field} mismatch); re-run prepare inside this run instead of binding foreign evidence: ${resetSource}`
      );
    }
  }
  const resetMs = Date.parse(reset?.resetAt ?? '');
  if (!Number.isFinite(resetMs)) {
    throw new Error(
      `profile-reset record has no usable resetAt: ${resetSource}`
    );
  }
  if (startedMs < resetMs - CLOCK_SKEW_MS) {
    throw new Error(
      `HAR page predates the profile reset; re-run the navigation inside this run instead of binding older evidence: ${har}`
    );
  }
  // The prepared session must precede the navigation it certifies: a
  // foreign HAR captured before the prepared launch would otherwise
  // gain that launch's version and profile binding. Unstamped segments
  // skip this ordering check (no launch time to compare).
  if (sessionMs !== null && startedMs + SESSION_NAV_SLACK_MS < sessionMs) {
    throw new Error(
      `HAR page predates the prepared-browser session; re-run the navigation inside this run instead of binding older evidence: ${har}`
    );
  }
  // Publish nothing until every check below passes: when finish is
  // retried into a directory holding an earlier finish of the same run,
  // an early run.har write would strand the new HAR beside the old
  // screenshot set on a later failure, and the shared run id plus
  // overlapping timestamps would let a later run certify artifacts from
  // different navigations. The bound set lands together, after all
  // validation.
  const { height, width } = sessionViewport;
  const deviceScaleFactor = handle.deviceScaleFactor;
  const captureRecord = await bindScreenshotCapture({
    clockSkewMs: CLOCK_SKEW_MS,
    deviceScaleFactor,
    height,
    nowMs,
    provenanceWindowMs: PROVENANCE_WINDOW_MS,
    runId: handle.runId,
    screenshot: required(screenshot, 'screenshot'),
    startedMs,
    tool: handle.tool,
    width,
  });
  // Executable provenance for the gate: the log-recorded dotted build
  // and launch time, bound to this run id inside the same window the
  // HAR checks. Validated here (bind time), not at the gate. launchedAt
  // is the prepared session's own stamp when recorded; unstamped
  // segments fall back to the reset time, which always precedes the
  // navigation and keeps the gate's ordering check meaningful only for
  // stamped logs.
  const launchRecord = {
    event: 'browser-launch',
    executableVersion,
    // Markerless non-Browsertime segments (Caps-style drivers) bind
    // with first navigation explicitly unverified: no silent cold
    // certification, and the settings gate refuses the flag.
    ...(navigationCount === 0 ? { firstNavigationUnverified: true } : {}),
    launchedAt:
      sessionMs === null ? reset.resetAt : new Date(sessionMs).toISOString(),
    runId: handle.runId,
    tool: handle.tool,
  };
  const published = await publishBoundSet({
    capture: captureRecord,
    harJson,
    io,
    launch: launchRecord,
    out,
    resetBytes: resetRead.bytes,
    screenshot,
  });
  return {
    browserLaunch: published.browserLaunch,
    capture: published.capture,
    har: published.har,
    runId: handle.runId,
  };
}
