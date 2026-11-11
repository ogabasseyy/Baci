import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync('.github/workflows/jules-pr-review.yml', 'utf8'));

function windowAt(day) {
  const dir = mkdtempSync(join(tmpdir(), 'jules-window-'));
  try {
    const date = join(dir, 'date');
    writeFileSync(date, '#!/bin/sh\n[ "$DATE_STUB" != "__fail__" ] || exit 1\nprintf "%s\\n" "$DATE_STUB"\n');
    chmodSync(date, 0o755);
    const output = join(dir, 'out');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', workflow.jobs.window.steps[0].run], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATE_STUB: day, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary') },
    });
    return { ...result, output: readFileSync(output, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('allows Jules through November 11 and skips new sessions afterward', () => {
  for (const [day, enabled] of [['2026-11-11', true], ['2026-11-12', false], ['2027-01-01', false]]) {
    const result = windowAt(day);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, new RegExp(`enabled=${enabled}`));
  }
  assert.deepEqual(workflow.jobs.review.needs, ['window']);
  assert.match(workflow.jobs.review.if, /needs\.window\.outputs\.enabled == 'true'/);
});
test('invalid clock output cannot enable the review', () => {
  for (const day of ['invalid', '__fail__']) {
    const result = windowAt(day);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.output, /enabled=true/);
  }
});

test('preserves trusted event eligibility and does not grant the window job permissions', () => {
  const condition = workflow.jobs.window.if;
  assert.equal(condition, String.raw`(github.event_name == 'pull_request' && github.event.pull_request.draft == true && github.event.pull_request.head.repo.full_name == github.repository) || (github.event_name == 'issue_comment' && github.event.issue.pull_request && (github.event.comment.body == '/jules deep review' || startsWith(toJSON(github.event.comment.body), '"/jules deep review\n') || startsWith(toJSON(github.event.comment.body), '"/jules deep review\r\n')) && (github.event.comment.author_association == 'OWNER' || github.event.comment.author_association == 'MEMBER' || github.event.comment.author_association == 'COLLABORATOR'))`);
  assert.deepEqual(workflow.jobs.window.permissions, {});
  const submit = workflow.jobs.review.steps.find((step) => step.name === 'Submit Jules review');
  assert.equal(submit.if, '${{ always() && !cancelled() }}');
});
