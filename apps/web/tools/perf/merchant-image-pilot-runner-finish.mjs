// Finish phase of the bound-evidence runner: stamp the run id into a
// COPY of the HAR (the raw export is never mutated), bind the
// screenshot by its OS-recorded mtime, and emit the screenshot-capture
// and browser-launch records. Split from
// merchant-image-pilot-runner.mjs under the repo line ceiling.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  MAX_BROWSER_LOG_BYTES,
  MAX_HAR_BYTES,
  MAX_SCREENSHOT_BYTES,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  readUpToBytes,
  writeJson,
} from './merchant-image-pilot-preflight-shared.mjs';
import {
  parseDimensions,
  parsePositiveNumber,
} from './merchant-image-pilot-settings-helpers.mjs';

const PROVENANCE_WINDOW_MS = 3_600_000;

// Same-machine clock/granularity slack for the run-window bounds. The
// capture-vs-navigation bound takes none: it mirrors the gate's strict
// capturedAt check exactly, so finish refuses what the gate would fail.
const CLOCK_SKEW_MS = 5_000;

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

export function required(value, flag) {
  if (value === undefined || value === '') {
    throw new Error(`missing required --${flag}`);
  }
  return value;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function finishRun({
  browserLog,
  dpr,
  har,
  outDir,
  runJson,
  screenshot,
  viewport,
}) {
  const handleRead = await readUpToBytes(required(runJson, 'run-json'), 65536);
  const handle = JSON.parse(handleRead.bytes.toString('utf8'));
  if (typeof handle?.runId !== 'string' || handle.runId.length === 0) {
    throw new Error(`run handle has no run id: ${runJson}`);
  }
  if (typeof handle.profileDir !== 'string' || handle.profileDir.length === 0) {
    throw new Error(`run handle has no prepared profile dir: ${runJson}`);
  }
  // Profile binding: the browser's recorded command line (Browsertime
  // --verbose log) must show a launch with the exact prepared profile
  // dir. A default- or reused-profile accident leaves no such token and
  // refuses here instead of stamping a warm navigation as cold. The
  // match is delimiter-terminated so a sibling prefix (/a/prof vs the
  // prepared /a/profile) cannot satisfy it.
  const logRead = await readUpToBytes(
    required(browserLog, 'browser-log'),
    MAX_BROWSER_LOG_BYTES
  );
  if (logRead.truncated) {
    throw new Error(
      `browser log exceeds ${MAX_BROWSER_LOG_BYTES} bytes: ${browserLog}`
    );
  }
  const logText = logRead.bytes.toString('utf8');
  const launched = new RegExp(
    `user-data-dir=${escapeRegExp(handle.profileDir)}(?=["'\\s]|$)`,
    'g'
  );
  const launches = logText.match(launched) ?? [];
  if (launches.length === 0) {
    throw new Error(
      `browser log shows no launch with the prepared profile dir (${handle.profileDir}); refusing to bind: ${browserLog}`
    );
  }
  // Exactly one launch: a retry with the same profile dir (warm-up run,
  // then a second run whose single-page HAR is submitted) would
  // otherwise stamp a warm navigation with the reset's cold run id.
  // Together with the single-page HAR rule, one launch means the bound
  // page is that profile's only recorded navigation.
  if (launches.length > 1) {
    throw new Error(
      `browser log shows ${launches.length} launches with the prepared profile dir (${handle.profileDir}); re-prepare instead of binding a possibly warm navigation: ${browserLog}`
    );
  }
  // Fail fast, before writing anything: without a recorded version the
  // launch record would carry caller text the gate cannot trust. The
  // version binds to the prepared-profile launch segment only — a
  // retry or unrelated session later in the log must not supply it.
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
  const executableVersion = executableVersionFromLog(launchSegment, browserLog);
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
  const boundHar = join(out, 'run.har');
  await writeFile(boundHar, `${JSON.stringify(harJson)}\n`);
  // Same-navigation screenshot binding: capturedAt is the file's
  // OS-recorded mtime, not finish time — and the capture must fall
  // inside the measured navigation's window. A stale file from another
  // run (or a future-dated one) refuses here instead of gaining this
  // run's id. The bounds mirror the gate's capturedAt checks exactly.
  const shotStat = await stat(required(screenshot, 'screenshot'));
  const shotMtimeMs = shotStat.mtimeMs;
  if (shotMtimeMs > nowMs + CLOCK_SKEW_MS) {
    throw new Error(
      `screenshot is newer than the finish clock (clock skew): ${screenshot}`
    );
  }
  if (shotMtimeMs < startedMs) {
    throw new Error(
      `screenshot predates the measured navigation; capture after navigating instead of binding a stale file: ${screenshot}`
    );
  }
  if (shotMtimeMs - startedMs > PROVENANCE_WINDOW_MS) {
    throw new Error(
      `screenshot is stale (>1h after the measured navigation); re-capture instead of binding old evidence: ${screenshot}`
    );
  }
  const shotRead = await readUpToBytes(screenshot, MAX_SCREENSHOT_BYTES);
  if (shotRead.truncated) {
    throw new Error(
      `screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes: ${screenshot}`
    );
  }
  const { height, width } = parseDimensions(
    required(viewport, 'viewport'),
    'viewport'
  );
  const deviceScaleFactor = parsePositiveNumber(required(dpr, 'dpr'), 'dpr');
  const capturePath = join(out, 'screenshot-capture.json');
  await writeJson(capturePath, {
    capturedAt: new Date(shotMtimeMs).toISOString(),
    deviceScaleFactor,
    event: 'screenshot-capture',
    runId: handle.runId,
    screenshotSha256: createHash('sha256').update(shotRead.bytes).digest('hex'),
    tool: handle.tool,
    viewport: { height, width },
  });
  await copyFile(screenshot, join(out, 'screenshot.png'));
  // Keep the bound set self-contained: when finishing into another
  // directory, the profile-reset record travels with it. A run handle
  // without its reset record is an incomplete run, not a partial bind.
  const resetDest = join(out, 'profile-reset.json');
  if (resolve(resetSource) !== resolve(resetDest)) {
    await writeFile(resetDest, resetRead.bytes);
  }
  // Executable provenance for the gate: the log-recorded dotted build,
  // bound to this run id inside the same window the HAR checks.
  // Validated here (bind time), not at the gate.
  const launchPath = join(out, 'browser-launch.json');
  await writeJson(launchPath, {
    event: 'browser-launch',
    executableVersion,
    launchedAt: reset.resetAt,
    runId: handle.runId,
    tool: handle.tool,
  });
  return {
    browserLaunch: launchPath,
    capture: capturePath,
    har: boundHar,
    runId: handle.runId,
  };
}
