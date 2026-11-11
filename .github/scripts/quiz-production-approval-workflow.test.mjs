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
  // The step used to live in quality-misc, which skips in config-smoke mode like every other quiz_db-gated job.
  assert.match(job.if, /needs\.changes\.outputs\.test_plan_mode != 'config-smoke'/);

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

test('bugfix: a merge-queue run checks out the trusted base commit, never pull request code, while holding the secrets', async () => {
  const workflow = YAML.parse(
    await readFile('.github/workflows/ci.yml', 'utf8')
  );
  const job = workflow.jobs['quality-quiz-approval'];
  const checkouts = job.steps.filter(({ uses }) =>
    uses?.startsWith('actions/checkout@')
  );

  // A merge_group commit contains pull request code. The check reads live database state, not the diff, so the
  // queue run uses the base commit the queue builds on; a push to main has no merge_group payload and falls
  // through to the pushed commit.
  assert.equal(checkouts.length, 1);
  assert.equal(
    checkouts[0].with.ref,
    '${{ github.event.merge_group.base_sha || github.sha }}'
  );
  assert.equal(checkouts[0].with['persist-credentials'], false);
  // A queue run whose payload lacks the base commit must fail before anything is checked out or installed, instead
  // of falling back to the merge commit while the secrets are in scope.
  const guard = job.steps[0];
  assert.match(guard.name, /Refuse a merge-queue run without a trusted base commit/);
  assert.equal(guard.if, "github.event_name == 'merge_group' && !github.event.merge_group.base_sha");
  assert.equal(guard.uses, undefined);
  assert.match(guard.run, /exit 1/);
  // Everything that runs repository code (install scripts, the check itself) comes after the pinned checkout.
  const firstCheckout = job.steps.indexOf(checkouts[0]);
  assert.equal(firstCheckout, 1);
  assert.ok(
    job.steps.findIndex(({ name }) => name === 'Verify Quiz Production Approval') >
      firstCheckout
  );
});
