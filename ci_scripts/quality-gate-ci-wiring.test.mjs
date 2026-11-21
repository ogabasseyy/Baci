import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

// The "Test agent quality-gate scripts" step of "Quality Gate - Misc" must run
// whenever a file it tests changes, even in a pull request that touches nothing
// else: the job has to be enabled by the agent_gate_scripts path filter, and the
// filter has to cover every script, test and doc copy the step depends on.

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const filters = YAML.parse(read('.github/filters/ci.yml'));
const ci = YAML.parse(read('.github/workflows/ci.yml'));
const misc = ci.jobs['quality-misc'];
const step = misc.steps.find(
  (candidate) => candidate.name === 'Test agent quality-gate scripts'
);

// The subset of path-filter globs the group uses: "**" crosses folders, "*" does not.
function globToRegExp(glob) {
  const source = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\uE000')
    .replace(/\*/g, '[^/]*')
    .replace(/\uE000/g, '.*');
  return new RegExp(`^${source}$`);
}

const matchesGroup = (path) =>
  filters.agent_gate_scripts.some((glob) => globToRegExp(glob).test(path));

test('the Misc job is enabled by the agent_gate_scripts filter output', () => {
  assert.match(
    misc.if,
    /needs\.changes\.outputs\.agent_gate_scripts == 'true'/
  );
});

test('the change detector publishes agent_gate_scripts from the path filter', () => {
  assert.match(
    ci.jobs.changes.outputs.agent_gate_scripts,
    /steps\.gate\.outputs\.agent_gate_scripts/
  );
  const gate = ci.jobs.changes.steps.find(
    (candidate) => candidate.id === 'gate'
  );
  assert.match(
    gate.env.FILTER_AGENT_GATE_SCRIPTS,
    /steps\.filter\.outputs\.agent_gate_scripts/
  );
});

test('the gate-script test step has no condition of its own', () => {
  assert.ok(step, 'step "Test agent quality-gate scripts" exists');
  assert.equal(step.if, undefined);
});

test('every test, script and doc copy the step relies on is covered by the filter group', () => {
  const referenced = step.run.match(
    /(?:ci_scripts|\.claude\/hooks|\.codex\/hooks)\/[\w.-]+/g
  );
  assert.ok(referenced.length >= 8, 'the step names its test files');
  const covered = [
    ...referenced,
    'ci_scripts/quality-gate-affected-base.sh',
    'ci_scripts/quality-gate-affected-base.test-helpers.mjs',
    'ci_scripts/resolve-turbo-cmd.sh',
    '.claude/hooks/quality-gate-check-worktree.sh',
    '.codex/hooks/quality-gate-affected-scope.sh',
    'AGENTS.md',
    'CLAUDE.md',
    '.ruler/01-critical-rules.md',
    '.ruler/02-code-standards.md',
    '.ruler/07-testing.md',
  ];
  for (const path of covered) {
    assert.ok(existsSync(new URL(path, root)), `${path} exists`);
    assert.ok(
      matchesGroup(path),
      `${path} must match the agent_gate_scripts filter`
    );
  }
});

test('the filter group stays narrow: ordinary application code does not enable it', () => {
  for (const path of [
    'apps/web/src/app/page.tsx',
    'packages/shared/src/index.ts',
    'supabase/migrations/20990101000000_example.sql',
  ]) {
    assert.equal(matchesGroup(path), false, path);
  }
});
