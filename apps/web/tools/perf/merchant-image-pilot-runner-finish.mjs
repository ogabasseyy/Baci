// Finish phase of the bound-evidence runner: stamp the run id into a
// COPY of the HAR (the raw export is never mutated), bind the
// screenshot by its OS-recorded mtime, and emit the screenshot-capture
// and browser-launch records. Split from
// merchant-image-pilot-runner.mjs under the repo line ceiling.
//
// Trust model: the HAR, log, and screenshot are operator-supplied
// artifacts. Finish checks their mutual consistency (single launch,
// single page, recorded version/session binding, time windows, PNG
// geometry) and freezes the bound set for audit — it cannot prove a
// malicious operator captured them honestly (mtime and file bytes are
// equally forgeable), only refuse the inconsistent and the stale.
// Capture authenticity is an operator responsibility, same as HAR
// authorship; the recorded hashes freeze the pair the operator chose.
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
  resolvePreparedLaunch,
  SESSION_NAV_SLACK_MS,
} from './merchant-image-pilot-runner-finish-log.mjs';
import {
  parseDimensions,
  parsePositiveNumber,
} from './merchant-image-pilot-settings-helpers.mjs';

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

// PNG geometry without a decoder dependency: 8-byte signature plus the
// IHDR chunk (length 13, width/height big-endian). A non-PNG file, or a
// capture at the wrong size, refuses here instead of gaining the run's
// id with geometry the gate would trust from the record alone.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngDimensions(bytes, screenshot) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('latin1') !== 'IHDR'
  ) {
    throw new Error(`screenshot is not a PNG file: ${screenshot}`);
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
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
  const { executableVersion, sessionMs } = resolvePreparedLaunch(
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
  // The prepared session must precede the navigation it certifies: a
  // foreign HAR captured before the prepared launch would otherwise
  // gain that launch's version and profile binding. Unstamped segments
  // skip this ordering check (no launch time to compare).
  if (sessionMs !== null && startedMs + SESSION_NAV_SLACK_MS < sessionMs) {
    throw new Error(
      `HAR page predates the prepared-browser session; re-run the navigation inside this run instead of binding older evidence: ${har}`
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
  // The claimed viewport/dpr are caller text: the capture's actual
  // pixels must agree, or a wrong-size file gains a geometry the gate
  // would trust from the record alone.
  const expectedWidth = Math.round(width * deviceScaleFactor);
  const expectedHeight = Math.round(height * deviceScaleFactor);
  const actual = pngDimensions(shotRead.bytes, screenshot);
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    throw new Error(
      `screenshot is ${actual.width}x${actual.height} but viewport ${width}x${height} at dpr ${deviceScaleFactor} requires ${expectedWidth}x${expectedHeight}: ${screenshot}`
    );
  }
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
  // Executable provenance for the gate: the log-recorded dotted build
  // and launch time, bound to this run id inside the same window the
  // HAR checks. Validated here (bind time), not at the gate. launchedAt
  // is the prepared session's own stamp when recorded; unstamped
  // segments fall back to the reset time, which always precedes the
  // navigation and keeps the gate's ordering check meaningful only for
  // stamped logs.
  const launchPath = join(out, 'browser-launch.json');
  await writeJson(launchPath, {
    event: 'browser-launch',
    executableVersion,
    launchedAt:
      sessionMs === null ? reset.resetAt : new Date(sessionMs).toISOString(),
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
