// Line-based reader for the parts of a GitHub Actions workflow that the
// storefront release gate checks: the top-level `on:` triggers, job blocks
// and named step blocks. It reads only the plain block style these workflows use and reports
// any other shape as unreadable, so a trigger it cannot read fails the gate
// instead of slipping past it. It runs with no installed packages, which lets
// CI run the gate before dependencies are installed.

const TOP_LEVEL_ON = /^(?:on|"on"|'on')\s*:(.*)$/;
const EVENT_LINE = /^([A-Za-z_]+)\s*:(.*)$/;
const KEY_LINE = /^([A-Za-z_-]+)\s*:(.*)$/;
const EMPTY_VALUE = new Set(['', '{}', 'null', '~']);

function stripComment(value) {
  const index = value.search(/(^|\s)#/);
  return (index === -1 ? value : value.slice(0, index)).trim();
}

function unquote(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

function inlineList(value) {
  const inner = value.match(/^\[(.*)\]$/);
  if (!inner) return [unquote(value)];
  return inner[1]
    .split(',')
    .map(unquote)
    .filter((item) => item !== '');
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Returns `{ events }`, a Map of trigger name to a Map of its direct keys and
 * their list values, or `{ error }` when the block cannot be read safely.
 */
export function readWorkflowTriggers(text) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (TOP_LEVEL_ON.test(line) ? [index] : []));
  if (starts.length === 0) return { error: 'has no top-level on: block' };
  if (starts.length > 1) return { error: 'declares on: more than once' };
  const [start] = starts;
  if (stripComment(lines[start].match(TOP_LEVEL_ON)[1]) !== '') {
    return { error: 'must declare on: as a block mapping' };
  }
  const events = new Map();
  let event;
  let key;
  for (const line of lines.slice(start + 1)) {
    const body = stripComment(line.trim());
    if (body === '') continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (indent === 2) {
      const match = body.match(EVENT_LINE);
      if (!match) return { error: `has an unreadable trigger line: ${body}` };
      if (events.has(match[1])) return { error: `declares ${match[1]} more than once` };
      if (!EMPTY_VALUE.has(match[2].trim())) return { error: `must declare ${match[1]} as a block mapping` };
      event = match[1];
      key = undefined;
      events.set(event, new Map());
    } else if (indent === 4 && event === 'schedule' && body.startsWith('- ')) {
      // Cron entries carry no branch, path or tag filters.
    } else if (indent === 4 && event) {
      const match = body.match(KEY_LINE);
      if (!match) return { error: `has an unreadable ${event} line: ${body}` };
      key = match[1];
      const value = match[2].trim();
      events.get(event).set(key, EMPTY_VALUE.has(value) ? [] : inlineList(value));
    } else if (indent === 6 && key && body.startsWith('- ')) {
      events.get(event).get(key).push(unquote(body.slice(2)));
    } else if (indent < 6) {
      return { error: `has an unreadable trigger line: ${body}` };
    }
  }
  return { events };
}

function eventNames(events) {
  return [...events.keys()].sort();
}

/** Failures for a store release workflow: owner tag push and manual dispatch only. */
export function releaseTriggerFailures(name, text, expectedTags) {
  const { events, error } = readWorkflowTriggers(text);
  if (error) return [`${name} ${error}`];
  const failures = [];
  const names = eventNames(events);
  if (names.join(',') !== 'push,workflow_dispatch') {
    failures.push(`${name} must trigger only on an owner tag push and workflow_dispatch (found: ${names.join(', ')})`);
  }
  const push = events.get('push') ?? new Map();
  const pushKeys = [...push.keys()].sort();
  if (events.has('push') && pushKeys.join(',') !== 'tags') {
    failures.push(`${name} push trigger must list only tags (found: ${pushKeys.join(', ') || 'none'})`);
  }
  const tags = push.get('tags') ?? [];
  if (JSON.stringify(tags) !== JSON.stringify(expectedTags)) {
    failures.push(`${name} must keep its owner release tag ${expectedTags.join(', ')}`);
  }
  return failures;
}

/** Failures for a workflow that may only ever start from a manual dispatch. */
export function dispatchOnlyFailures(name, text) {
  const { events, error } = readWorkflowTriggers(text);
  if (error) return [`${name} ${error}`];
  const names = eventNames(events);
  return names.join(',') === 'workflow_dispatch'
    ? []
    : [`${name} must trigger only on workflow_dispatch (found: ${names.join(', ')})`];
}

const STOREFRONT_APP = /apps\/mobile-storefront\b|@baci\/mobile-storefront\b|com\.ogabassey\.store\b/;
const SHIPPING_TOOL =
  // A quoted or path-segment `fastlane` names a directory, not the tool.
  /(?<![\w\x27"\/.-])fastlane(?![\w\x27"\/-])|upload-google-play|upload-testflight|\baltool\b|\bexpo\s+export\b|\b(?:bundle|assemble|publish)\w*Release\b|\beas(?:-cli(?:@[\w.^~-]+)?)?\s+(?:build|submit|update|workflow:run)\b/;

/** True when a workflow or action builds, uploads, submits or exports the storefront app. */
export function shipsStorefront(text, scopedText = '') {
  // `scopedText` is the part of `text` read from the storefront package or directory.
  return (STOREFRONT_APP.test(text) && SHIPPING_TOOL.test(text)) || SHIPPING_TOOL.test(scopedText);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The text of one job under the top-level `jobs:` block, from its `  <id>:`
 * line to the next job, or undefined. Checks that read steps use this, so a
 * step moved into another job never counts.
 */
export function readJob(text, id) {
  const lines = text.split(/\r?\n/);
  const jobsAt = lines.findIndex((line) => /^jobs\s*:\s*(?:#.*)?$/.test(line));
  if (jobsAt === -1) return undefined;
  const header = new RegExp(`^  ${escapeRegExp(id)}\\s*:\\s*(?:#.*)?$`);
  let start = -1;
  for (let index = jobsAt + 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== '' && indentOf(lines[index]) === 0) break;
    if (header.test(lines[index])) {
      start = index;
      break;
    }
  }
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > 2)) end += 1;
  return lines.slice(start, end).join('\n');
}

const STEP_NAME = /^(\s*)- ["']?name["']?:\s*(.+?)\s*$/;

const STEP_START = /^\s*- ["']?(?:(name)|(?:run|uses|id|if|env|with|shell|working-directory|continue-on-error|timeout-minutes))["']?:/;
export const UNNAMED_STEP = '(unnamed step)';

/** Step names in file order; a step that does not start with `name:` shows as UNNAMED_STEP. */
export function readStepNames(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(STEP_START);
    if (!match) return [];
    return [match[1] ? unquote(line.match(STEP_NAME)?.[2] ?? UNNAMED_STEP) : UNNAMED_STEP];
  });
}

/** Ids of every job under the top-level `jobs:` block. */
export function readJobIds(text) {
  const lines = text.split(/\r?\n/);
  const jobsAt = lines.findIndex((line) => /^jobs\s*:\s*(?:#.*)?$/.test(line));
  if (jobsAt === -1) return [];
  const ids = [];
  for (const line of lines.slice(jobsAt + 1)) {
    if (line.trim() !== '' && indentOf(line) === 0 && !line.trim().startsWith('#')) break;
    const match = line.match(/^  (?:(['"])([^'"\s]+)\1|([\w-]+))\s*:\s*(?:#.*)?$/);
    if (match) ids.push(match[2] ?? match[3]);
    // Any other entry at job level is a job the reader cannot name: count it so a second job cannot hide.
    else if (indentOf(line) === 2 && line.trim() !== '' && !line.trim().startsWith('#')) ids.push('(unreadable job entry)');
  }
  return ids;
}

function blockScalar(lines, runIndex) {
  const runIndent = indentOf(lines[runIndex]);
  const body = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() !== '' && indentOf(line) <= runIndent) break;
    body.push(line);
  }
  while (body.length > 0 && body.at(-1).trim() === '') body.pop();
  const indents = body.filter((line) => line.trim() !== '').map(indentOf);
  const margin = Math.min(...indents);
  return body.map((line) => line.slice(margin)).join('\n');
}

/** The raw text of a named step and, when it uses `run: |`, its dedented script. */
export function readStep(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = line.match(STEP_NAME);
    return match !== null && unquote(match[2]) === name;
  });
  if (start === -1) return undefined;
  const stepIndent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > stepIndent)) end += 1;
  const step = lines.slice(start, end);
  const runIndex = step.findIndex((line, index) => index > 0 && /^run:\s*\|\s*$/.test(line.trim()));
  return {
    text: step.join('\n'),
    run: runIndex === -1 ? undefined : blockScalar(step, runIndex),
  };
}
