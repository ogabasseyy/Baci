import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

test('runs the quiz runtime parity gate for phase 1a and production', async () => {
  const workflow = YAML.parse(
    await readFile('.github/workflows/ci.yml', 'utf8')
  );
  // The gate needs the Supabase service-role key, so it lives in its own job that
  // only runs for pushes to the default branch and merge groups, never in a job
  // that pull requests reach on the shared CI runner.
  const job = workflow.jobs['quality-quiz-approval'];

  assert.ok(job, 'quiz runtime parity gate must remain in its own job');
  assert.match(job.if, /github\.event_name == 'push'/);
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job.if, /github\.event_name == 'merge_group'/);
  assert.match(job.if, /vars\.QUIZ_PHASE == '1a'/);
  assert.match(job.if, /vars\.QUIZ_PHASE == 'production'/);

  const step = job.steps.find(
    ({ name }) => name === 'Verify Quiz Production Approval'
  );
  assert.ok(step, 'the job must run the Verify Quiz Production Approval step');
  assert.equal(
    step.env.QUIZ_RPC_SERVER_SECRET,
    '${{ secrets.QUIZ_RPC_SERVER_SECRET }}'
  );
  assert.equal(step.run, 'pnpm --filter @baci/web check:quiz-approval');

  assert.ok(
    workflow.jobs.quality.needs.includes('quality-quiz-approval'),
    'the required Quality Gate must wait for the quiz runtime parity gate'
  );
  assert.equal(
    workflow.jobs['quality-misc'].steps.some(
      ({ name }) => name === 'Verify Quiz Production Approval'
    ),
    false,
    'the secret-bearing step must not stay in the shared quality-misc job'
  );
});
