import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

test('runs the quiz runtime parity gate for phase 1a and production', async () => {
  const workflow = YAML.parse(
    await readFile('.github/workflows/ci.yml', 'utf8')
  );
  const step = workflow.jobs['quality-misc'].steps.find(
    ({ name }) => name === 'Verify Quiz Production Approval'
  );

  assert.ok(step, 'quiz runtime parity gate must remain in the quality job');
  assert.match(step.if, /github\.event_name == 'push'/);
  assert.match(step.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(step.if, /github\.event_name == 'merge_group'/);
  assert.match(step.if, /vars\.QUIZ_PHASE == '1a'/);
  assert.match(step.if, /vars\.QUIZ_PHASE == 'production'/);
  assert.equal(
    step.env.QUIZ_RPC_SERVER_SECRET,
    '${{ secrets.QUIZ_RPC_SERVER_SECRET }}'
  );
  assert.equal(step.run, 'pnpm --filter @baci/web check:quiz-approval');
});
