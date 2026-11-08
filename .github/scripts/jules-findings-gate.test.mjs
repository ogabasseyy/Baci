import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync('.github/workflows/jules-pr-review.yml', 'utf8'));
const gate = workflow.jobs.review.steps.find((step) => step.name === 'Gate on Jules findings').run;

function runGate(body) {
  const dir = mkdtempSync(join(tmpdir(), 'jules-gate-'));
  try {
    if (body !== null) writeFileSync(join(dir, 'jules-review.md'), body);
    return spawnSync('bash', ['-c', gate], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, PR_LABELS: '[]' },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const clean = `## Findings
- **High:** No high-severity issues found.
- **Medium:** No medium-severity issues found.
- **Low:** No low-severity issues found.
`;

test('accepts the exact clean severity statements Jules returned', () => {
  assert.equal(runGate(clean).status, 0);
});

test('still blocks real findings, including contradictions and appended text', () => {
  for (const body of [
    '- **High:** Sensitive credentials leak.',
    '- Medium: An authorization check is missing.',
    `${clean}- **Low:** A real defect exists.`,
    '- **High:** No high-severity issues found. However, credentials leak.',
    '- **High:** No high-severity issues found.\n  However, credentials leak.',
    '- **High:** No high-severity issues found.\n\n  However, credentials leak.',
    '- **High:** No high-severity issues found.\nHowever, credentials leak.',
    '- **High:** No medium-severity issues found.',
  ]) assert.notEqual(runGate(body).status, 0, body);
});

test('retains existing advisory behavior when the review body is absent', () => {
  assert.equal(runGate(null).status, 0);
});
