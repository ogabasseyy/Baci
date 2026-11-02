// Dispatch rule of the storefront release gate: no workflow or composite
// action may start a gated workflow. A workflow can be started by its file
// name, its display name or its numeric ID, or through a variable, so any
// dispatch target that is not a literal workflow file name fails closed: the
// gate cannot tell which workflow it starts.
import path from 'node:path';

const GH_WORKFLOW_RUN = /\bgh\s+workflow\s+run\b/g;
const REST_DISPATCH = /\/workflows\/(.*?)\/dispatches\b/g;
const SCRIPT_DISPATCH = /\bcreateWorkflowDispatch\b/;
const WORKFLOW_ID = /\bworkflow_id\s*:\s*([^,\n}]*)/g;
// `gh workflow run` flags that take the next argument as their value.
const VALUE_FLAGS = new Set(['-f', '--raw-field', '-F', '--field', '-r', '--ref', '-R', '--repo']);
const SHELL_TOKEN = /"[^"]*"|'[^']*'|[;&|)]|[^\s;&|)]+/g;
const WORKFLOW_FILE = /^[\w.-]+\.ya?ml$/;

function unquote(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

// Shell line continuations become one line, and comment lines run nothing.
function logicalLines(text) {
  return text
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'));
}

// The first positional argument after `gh workflow run`, or '' when none.
function ghRunTarget(rest) {
  const tokens = rest.match(SHELL_TOKEN) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^[;&|)]$/.test(token) || token.startsWith('#')) break;
    if (!token.startsWith('-')) return unquote(token);
    if (!token.includes('=') && VALUE_FLAGS.has(token)) index += 1;
  }
  return '';
}

/** Every workflow dispatch target in a workflow or action file, in file order. */
export function readDispatchTargets(text) {
  const targets = [];
  for (const line of logicalLines(text)) {
    for (const match of line.matchAll(GH_WORKFLOW_RUN)) {
      targets.push(ghRunTarget(line.slice(match.index + match[0].length)));
    }
    for (const match of line.matchAll(REST_DISPATCH)) targets.push(unquote(match[1]));
  }
  if (SCRIPT_DISPATCH.test(text)) {
    const ids = [...text.matchAll(WORKFLOW_ID)].map((match) => unquote(match[1]));
    targets.push(...(ids.length === 0 ? [''] : ids));
  }
  return targets;
}

/** Failures for a file that starts a gated workflow, or a workflow the gate cannot identify. */
export function dispatchFailures(file, text, gatedWorkflows) {
  const failures = [];
  for (const target of readDispatchTargets(text)) {
    const name = target.replace(/^\.github\/workflows\//, '');
    const gated = gatedWorkflows.find((workflow) => path.basename(workflow) === name);
    const failure = !WORKFLOW_FILE.test(name)
      ? `${file} starts a workflow the storefront release gate cannot identify (${target || 'no target'}): name the workflow file literally, for example gh workflow run security.yml (see docs/runbooks/storefront-release-gate.md)`
      : gated && `${file} dispatches the gated ${gated}`;
    if (failure && !failures.includes(failure)) failures.push(failure);
  }
  return failures;
}
