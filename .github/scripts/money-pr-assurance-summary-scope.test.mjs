// Change summaries are validated per PR, never as a whole directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadRawConfig,
  readRepoFile,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  findChangedSummaries,
  validateSummary,
} from './money-pr-assurance-summary.mjs';

const config = parseAssuranceConfig(loadRawConfig());

// Only the summary a PR adds or changes is validated, never the whole
// directory: older summaries predate the check and must not fail other PRs.
const MALFORMED = 'Uses `code` identifiers.\n';
const validateOwn = (file) =>
  validateSummary(readRepoFile(`${config.summary.directory}/${file}`), {
    taskId: file.slice(0, -3),
    ...config.summary,
  });

test('this task\'s own change summary passes the validator', () => {
  assert.deepEqual(validateOwn('G0-money-pr-assurance.md').errors, []);
});

test('a malformed pre-existing summary does not fail an unrelated PR', () => {
  const unrelated = [
    { filename: 'apps/web/src/lib/x.ts', status: 'modified' },
    { filename: `${config.summary.directory}/TEMPLATE.md`, status: 'modified' },
  ];
  // The malformed summary is not among the PR's files, so nothing is checked.
  assert.deepEqual(findChangedSummaries(unrelated, config.summary).summaries, []);
});

test('a malformed summary in the PR\'s own change fails', () => {
  const own = [
    {
      filename: `${config.summary.directory}/FIX-own-task.md`,
      status: 'added',
    },
  ];
  const { summaries } = findChangedSummaries(own, config.summary);
  assert.deepEqual(
    summaries.map((summary) => summary.taskId),
    ['FIX-own-task']
  );
  const result = validateSummary(MALFORMED, {
    taskId: summaries[0].taskId,
    ...config.summary,
  });
  assert.notDeepEqual(result.errors, []);
});

