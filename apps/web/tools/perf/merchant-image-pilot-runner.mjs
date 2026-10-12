// Bound-evidence runner for the pilot effective-settings gate: the two
// phases operators run around their Browsertime/Sitespeed navigation so
// the gate's provenance validators have machine-bound artifacts instead
// of hand-written JSON.
//
//   1. prepare: mint a run id, create the fresh browser profile dir, and
//      emit the profile-reset record plus a run handle for phase 2.
//   2. (operator navigates with the prepared profile and captures the
//      HAR + screenshot, within the hour)
//   3. finish: stamp the run id into a COPY of the HAR (the raw export
//      is never mutated), hash the screenshot, and emit the
//      screenshot-capture and browser-launch records.
//
// Honesty boundaries: freshProfile is true by construction (the runner
// creates the profile dir itself and refuses non-empty ones), and
// finish binds only when the browser's recorded command line shows a
// launch with that exact profile dir — a default- or reused-profile
// accident refuses instead of stamping a warm navigation as cold. The
// launch record reuses the profile-reset timestamp: the log proves the
// launch happened after that reset, inside the run window.
// finish also refuses stale (>1h), future-dated, multi-page, and
// already-bound HARs instead of emitting records the gate would fail —
// bind-time refusal, not gate-time surprise.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
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
import { parseArgs as parseStrictArgs } from './merchant-image-pilot-readiness-config.mjs';
import {
  parseDimensions,
  parsePositiveNumber,
} from './merchant-image-pilot-settings-helpers.mjs';

const RUNNER_CLI_OPTIONS = [
  'browser-log',
  'browser-version',
  'dpr',
  'har',
  'out-dir',
  'phase',
  'profile-dir',
  'run-json',
  'screenshot',
  'tool',
  'viewport',
];

const PROVENANCE_WINDOW_MS = 3_600_000;

function required(value, flag) {
  if (value === undefined || value === '') {
    throw new Error(`missing required --${flag}`);
  }
  return value;
}

function checkedTool(tool) {
  if (typeof tool !== 'string' || tool.length === 0 || tool.length > 500) {
    throw new Error('bad --tool: expected a non-empty runner name');
  }
  return tool;
}

export async function prepareRun({ outDir, profileDir, tool }) {
  const checked = checkedTool(required(tool, 'tool'));
  const profile = required(profileDir, 'profile-dir');
  const out = required(outDir, 'out-dir');
  await mkdir(profile, { recursive: true });
  // Fresh by construction: a non-empty directory is someone else's
  // profile, never a reset. The operator removes it or picks another
  // path — the runner never deletes operator data.
  if ((await readdir(profile)).length > 0) {
    throw new Error(`profile dir is not empty (not fresh): ${profile}`);
  }
  await mkdir(out, { recursive: true });
  const runId = randomUUID();
  const resetAt = new Date().toISOString();
  await writeJson(join(out, 'profile-reset.json'), {
    event: 'profile-reset',
    freshProfile: true,
    profileDir: profile,
    resetAt,
    runId,
    tool: checked,
  });
  await writeJson(join(out, 'run.json'), {
    profileDir: profile,
    runId,
    tool: checked,
  });
  return { outDir: out, profileDir: profile, resetAt, runId };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function finishRun({
  browserLog,
  browserVersion,
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
  const launched = new RegExp(
    `user-data-dir=${escapeRegExp(handle.profileDir)}(?=["'\\s]|$)`
  );
  if (!launched.test(logRead.bytes.toString('utf8'))) {
    throw new Error(
      `browser log shows no launch with the prepared profile dir (${handle.profileDir}); refusing to bind: ${browserLog}`
    );
  }
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
  const boundHar = join(out, 'run.har');
  await writeFile(boundHar, `${JSON.stringify(harJson)}\n`);
  const shotRead = await readUpToBytes(
    required(screenshot, 'screenshot'),
    MAX_SCREENSHOT_BYTES
  );
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
    capturedAt: new Date().toISOString(),
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
  const resetSource = join(dirname(runJson), 'profile-reset.json');
  const resetRead = await readUpToBytes(resetSource, 64 * 1024).catch(() => {
    throw new Error(`run handle has no profile-reset record: ${resetSource}`);
  });
  const resetDest = join(out, 'profile-reset.json');
  if (resolve(resetSource) !== resolve(resetDest)) {
    await writeFile(resetDest, resetRead.bytes);
  }
  // Executable provenance for the gate: the operator-observed dotted
  // build, bound to this run id inside the same window the HAR checks.
  // Validated here (bind time), not at the gate.
  const reset = JSON.parse(resetRead.bytes.toString('utf8'));
  if (!Number.isFinite(Date.parse(reset?.resetAt ?? ''))) {
    throw new Error(
      `profile-reset record has no usable resetAt: ${resetSource}`
    );
  }
  const executableVersion = required(browserVersion, 'browser-version');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(executableVersion)) {
    throw new Error(`bad --browser-version: ${executableVersion}`);
  }
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

const USAGE = `merchant-image-pilot-runner.mjs binds measurement evidence to the effective-settings gate.
  prepare: --phase=prepare --profile-dir=P --tool=T --out-dir=O
  finish:  --phase=finish --run-json=O/run.json --har=H.har --screenshot=S.png --viewport=WxH --dpr=N --browser-log=B.log --browser-version=V --out-dir=O2
  (capture with Browsertime --verbose and the prepared profile dir; finish verifies the recorded launch before binding)`;

export async function runRunner(argv) {
  const args = parseStrictArgs(argv, RUNNER_CLI_OPTIONS);
  if (args.phase === 'prepare') {
    return await prepareRun({
      outDir: args['out-dir'],
      profileDir: args['profile-dir'],
      tool: args.tool,
    });
  }
  if (args.phase === 'finish') {
    return await finishRun({
      browserLog: args['browser-log'],
      browserVersion: args['browser-version'],
      dpr: args.dpr,
      har: args.har,
      outDir: args['out-dir'],
      runJson: args['run-json'],
      screenshot: args.screenshot,
      viewport: args.viewport,
    });
  }
  throw new Error(`bad --phase: ${args.phase ?? '(missing)'}\n${USAGE}`);
}

const isMain = process.argv[1]?.endsWith('merchant-image-pilot-runner.mjs');
if (isMain) {
  runRunner(process.argv.slice(2)).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}
