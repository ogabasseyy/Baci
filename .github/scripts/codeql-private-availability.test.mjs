import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(await readFile('.github/workflows/codeql.yml', 'utf8'));

test('CodeQL only analyzes public repositories and makes private unavailability explicit', () => {
  assert.match(workflow.jobs.analyze.if, /toJSON\(github\.event\.repository\.private\)\s*==\s*'false'/);
  const notice = workflow.jobs['private-unavailable'];
  assert.match(notice.if, /toJSON\(github\.event\.repository\.private\)\s*==\s*'true'/);
  const message = notice.steps.map((step) => step.run ?? '').join('\n');
  assert.match(message, /CodeQL.*unavailable/i);
  assert.match(message, /Semgrep/i);
  assert.doesNotMatch(message, /equivalent|replacement/i);
});

test('visibility strings only match actual boolean values', () => {
  for (const value of [null, undefined, '', 'false', 'true', 0, 1]) {
    assert.notEqual(JSON.stringify(value), 'false');
    assert.notEqual(JSON.stringify(value), 'true');
  }
  assert.equal(JSON.stringify(false), 'false');
  assert.equal(JSON.stringify(true), 'true');
});
