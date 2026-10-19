import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { readWorkflowRunStatus } from './read-workflow-run-status.mjs';

test('helper-only changes select the existing deployment-script CI suite', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const path of ['.github/scripts/read-workflow-run-status.mjs', '.github/scripts/read-workflow-run-status.test.mjs']) {
    assert.ok(filters.deploy_scripts.includes(path), `${path} must trigger deployment-script tests`);
  }
});

test('reads nullable run conclusions after the subprocess trims its output', () => {
  const calls = [];
  const reading = readWorkflowRunStatus(
    args => {
      calls.push(args);
      return JSON.stringify({ status: 'queued', conclusion: null }).trim();
    },
    42
  );
  assert.deepEqual(reading, { status: 'queued', conclusion: '' });
  for (const [status, conclusion] of [['in_progress', null], ['completed', 'action_required'], ['completed', 'success'], ['completed', 'failure']]) {
    assert.deepEqual(readWorkflowRunStatus(() => JSON.stringify({ status, conclusion }).trim(), 42), { status, conclusion: conclusion ?? '' });
  }
  assert.ok(calls[0].join(' ').includes('{status, conclusion}'));
  for (const output of ['', 'null', '{}', '[]', '{"status":null,"conclusion":"success"}', '{"status":"null","conclusion":null}', '{"status":" ","conclusion":null}', '{"status":"queued"}', '{"status":"queued","conclusion":42}', 'queued']) {
    assert.throws(() => readWorkflowRunStatus(() => output, 42), /workflow run 42 status unreadable/);
  }
});

