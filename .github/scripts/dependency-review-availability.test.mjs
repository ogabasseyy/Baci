import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(await readFile('.github/workflows/dependency-review.yml', 'utf8'));

test('runs the entitlement-dependent review only for public pull requests', () => {
  const job = workflow.jobs['dependency-review'];
  assert.equal(job.if, "github.event_name == 'pull_request' && toJSON(github.event.repository.private) == 'false'");
  assert.ok(job.steps.some((step) => step.uses?.startsWith('actions/dependency-review-action@')));
});

test('clearly reports when private dependency review did not run', () => {
  const notice = workflow.jobs['private-dependency-review-unavailable'];
  assert.equal(notice.if, "github.event_name == 'pull_request' && toJSON(github.event.repository.private) == 'true'");
  assert.match(notice.name, /unavailable/i);
  assert.match(notice.steps[0].run, /did not run/i);
  assert.match(notice.steps[0].run, /Dependabot/i);
  assert.ok(!JSON.stringify(notice).includes('dependency-review-action@'));
});
