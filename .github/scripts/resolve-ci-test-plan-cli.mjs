// Command line plumbing of the CI test planner: arguments in, GitHub step
// outputs out. The planning itself lives in resolve-ci-test-plan.mjs.
import { appendFileSync } from 'node:fs';

/**
 * Reads `--base`, `--event` and `--head` from the command line.
 *
 * @param {string[]} argv
 * @returns {{ baseRef: string, eventName: string, headRef: string }}
 */
export function parseArgs(argv) {
  const args = {
    baseRef: 'origin/main',
    eventName: process.env.GITHUB_EVENT_NAME ?? 'pull_request',
    headRef: 'HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      args.baseRef = argv[index + 1] ?? args.baseRef;
      index += 1;
    } else if (arg === '--event') {
      args.eventName = argv[index + 1] ?? args.eventName;
      index += 1;
    } else if (arg === '--head') {
      args.headRef = argv[index + 1] ?? args.headRef;
      index += 1;
    }
  }

  return args;
}

/**
 * A value on one line. A line break in a file name or a ref would add lines to
 * the step output file, and each line is a new output.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function singleLine(value) {
  return String(value).replace(/[\r\n]+/g, ' ');
}

/**
 * Publishes the plan as step outputs when CI provides an output file.
 *
 * @param {{ mode: string, reason: string, command: string }} plan
 */
export function writeGithubOutput(plan) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `mode=${singleLine(plan.mode)}\nreason=${singleLine(plan.reason)}\ncommand=${singleLine(plan.command)}\n`
  );
}
