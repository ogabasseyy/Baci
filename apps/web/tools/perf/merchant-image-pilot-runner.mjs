// Bound-evidence runner for the pilot effective-settings gate: the two
// phases operators run around their Browsertime/Sitespeed navigation so
// the gate's provenance validators have machine-bound artifacts instead
// of hand-written JSON. The finish phase lives in
// merchant-image-pilot-runner-finish.mjs (split under the repo line
// ceiling); this module keeps prepare, the CLI, and dispatch.
//
//   1. prepare: mint a run id, create the fresh browser profile dir, and
//      emit the profile-reset record plus a run handle for phase 2.
//   2. (operator navigates with the prepared profile and captures the
//      HAR + screenshot, within the hour)
//   3. finish: stamp the run id into a COPY of the HAR, bind the
//      screenshot, and emit the screenshot-capture and browser-launch
//      records.
//
// Honesty boundaries: freshProfile is true by construction (the runner
// creates the profile dir itself and refuses non-empty ones). See the
// finish module for the binding-time refusal contract.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJson } from './merchant-image-pilot-preflight-shared.mjs';
import { parseArgs as parseStrictArgs } from './merchant-image-pilot-readiness-config.mjs';
import { finishRun, required } from './merchant-image-pilot-runner-finish.mjs';

const RUNNER_CLI_OPTIONS = [
  'browser-log',
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

const USAGE = `merchant-image-pilot-runner.mjs binds measurement evidence to the effective-settings gate.
  prepare: --phase=prepare --profile-dir=P --tool=T --out-dir=O
  finish:  --phase=finish --run-json=O/run.json --har=H.har --screenshot=S.png --viewport=WxH --dpr=N --browser-log=B.log --out-dir=O2
  (capture with Browsertime --verbose and the prepared profile dir; finish verifies the recorded launch and session version before binding)`;

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
