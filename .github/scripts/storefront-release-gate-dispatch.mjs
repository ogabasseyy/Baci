// Dispatch rule of the storefront release gate: no workflow or composite
// action may start a gated workflow. A workflow can be started by its file
// name, its display name or its numeric ID, or through a variable, so any
// dispatch target that is not a literal workflow file name fails closed: the
// gate cannot tell which workflow it starts.
import path from 'node:path';

const GH_WORKFLOW_RUN = /\bgh\s+workflow\s+run\b/g;
const REST_DISPATCH = /\/workflows\/(.*?)\/dispatches\b/g;
const SCRIPT_DISPATCH = /\bcreateWorkflowDispatch\b/g;
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
  const calls = [...text.matchAll(SCRIPT_DISPATCH)].length;
  if (calls > 0) {
    const ids = [...text.matchAll(WORKFLOW_ID)].map((match) => unquote(match[1]));
    targets.push(...ids);
    // Each call needs its own literal target: a call without one stays opaque.
    for (let extra = ids.length; extra < calls; extra += 1) targets.push('');
  }
  return targets;
}

// The store release workflows also start from an owner tag push, so creating a
// tag, a ref or a release starts them just as a dispatch does.
const TAG_COMMAND = /\bgit\s+tag\b|\bgh\s+release\s+(?:create|edit|upload)\b/;
const PUSH_TAG = /\bgit\s+push\b.*(?:--tags\b|--follow-tags\b|--mirror\b|\btag\s+\S|refs\/tags\/|\bv[\w.*${}-]*-storefront(?:-ios)?\b)/;
// A pushed ref the gate cannot read (a variable) may be a release tag.
const PUSH_UNRESOLVED = /\bgit\s+push\b[^\n;&|]*\$/;
const REF_API = /\/git\/(?:refs|tags)\b|\bcreateRef\b|\bcreateTag\b|\bcreateRelease\b/;
const RELEASE_API = /\b(?:gh\s+api|curl|fetch)\b.*\/releases\b(?!\/(?:latest|tags|download|\d+\/assets))/;
const RELEASE_ACTION =
  /\buses:\s*(?:softprops\/action-gh-release|actions\/create-release|ncipollo\/release-action|marvinpinto\/action-automatic-releases)\b/;

// Git global options that may sit between `git` and the subcommand.
const GIT_GLOBAL_OPTIONS =
  /\bgit(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+(?:"[^"]*"|'[^']*'|\S+)|--git-dir(?:=\S+|\s+\S+)|--work-tree(?:=\S+|\s+\S+)|--no-pager|--no-replace-objects|--bare))+(?=\s)/g;

function withoutGitOptions(line) {
  return line.replace(GIT_GLOBAL_OPTIONS, 'git');
}

/** True when the text creates or pushes a tag, ref or release. */
export function createsReleaseTag(text) {
  return logicalLines(text).map(withoutGitOptions).some(
    (line) =>
      TAG_COMMAND.test(line) || PUSH_TAG.test(line) || PUSH_UNRESOLVED.test(line) || REF_API.test(line) || RELEASE_API.test(line) || RELEASE_ACTION.test(line)
  );
}

/** Failures for a file that starts a gated workflow, or a workflow the gate cannot identify. */
export function dispatchFailures(file, text, gatedWorkflows) {
  const failures = createsReleaseTag(text)
    ? [`${file} creates a release tag, ref or release, which starts the gated storefront release workflows: tag releases are an owner action (see docs/runbooks/storefront-release-gate.md)`]
    : [];
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
