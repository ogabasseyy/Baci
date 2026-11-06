import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(
    new URL('../workflows/diff-guardian.yml', import.meta.url),
    'utf8',
  ),
);
const job = workflow.jobs.guardian;

test('the API-only guardian uses the cheaper runner without shortening its deadline', () => {
  assert.equal(job['runs-on'], 'ubuntu-slim');
  assert.equal(job['timeout-minutes'], 15);
  assert.deepEqual(
    job.steps.map((step) => step.name),
    ['Tally AI reviewers and gate by quorum'],
  );
  assert.deepEqual(workflow.on.workflow_run.workflows, [
    'Gemini Code Review',
    'Jules PR Review',
  ]);
  assert.deepEqual(workflow.on.pull_request_target.types, [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'labeled',
    'unlabeled',
  ]);
  assert.equal(workflow.permissions.statuses, 'write');
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(job.steps[0].env.VOTERS, 'Gemini review|Jules review');
  assert.equal(job.steps[0].env.BLOCK_QUORUM, '2');
});

for (const scenario of [
  'pass',
  'blocking quorum',
  'pending voter',
  'stale head',
  'bypass removed',
  'fork head changed',
]) {
  test(`guardian behavior remains enforced: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-guardian-runner-'));
    try {
      const sha = 'a'.repeat(40);
      const pr = {
        head: { sha, repo: { full_name: 'example/Baci' } },
        labels: [],
      };
      const statuses = [
        {
          context: 'Gemini review',
          state: 'success',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];
      const checks = [
        {
          name: 'Jules review',
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-01-01T00:00:00Z',
        },
      ];
      let action = 'synchronize';
      let label = '';
      if (scenario === 'blocking quorum' || scenario === 'pending voter')
        statuses[0].state = 'failure';
      if (scenario === 'blocking quorum') checks[0].conclusion = 'failure';
      if (scenario === 'pending voter') checks[0].status = 'in_progress';
      if (scenario === 'stale head') pr.head.sha = 'b'.repeat(40);
      if (scenario === 'bypass removed') {
        action = 'unlabeled';
        label = 'bypass-ai-gate';
      }
      if (scenario === 'fork head changed') {
        pr.head.repo.full_name = 'fork/Baci';
        pr.labels = [{ name: 'bypass-ai-gate' }];
      }
      writeFileSync(
        join(root, 'fixture.json'),
        JSON.stringify({ pr, statuses, checks }),
      );
      writeFileSync(
        join(root, 'gh'),
        `#!/usr/bin/env python3
import sys,os,json,pathlib
root=pathlib.Path(os.environ['FIXTURE_ROOT']);data=json.loads((root/'fixture.json').read_text());args=sys.argv[1:]
path=next(a for a in args if a.startswith('repos/'))
if '/statuses/' in path:
 state=next(a.split('=',1)[1]for a in args if a.startswith('state='));(root/'posted.json').write_text(json.dumps({'state':state}));print('{}')
elif '/pulls/'in path:print(json.dumps(data['pr']))
elif '/check-runs?'in path:print(json.dumps({'check_runs':data['checks']}))
elif path.endswith('/status'):print(json.dumps({'statuses':data['statuses']}))
else:raise RuntimeError('unexpected API operation')
`,
        { mode: 0o755 },
      );
      const result = spawnSync('bash', ['-c', job.steps[0].run], {
        encoding: 'utf8',
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          FIXTURE_ROOT: root,
          REPO: 'example/Baci',
          SHA: sha,
          PR: '42',
          EVENT_ACTION: action,
          EVENT_LABEL: label,
          VOTERS: 'Gemini review|Jules review',
          BLOCK_QUORUM: '2',
          GITHUB_RUN_ID: '123',
        },
      });
      if (scenario === 'stale head') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          existsSync(join(root, 'posted.json')),
          false,
          'stale head must not overwrite a verdict',
        );
      } else {
        const expected =
          scenario === 'pass'
            ? 'success'
            : scenario === 'pending voter'
              ? 'pending'
              : 'failure';
        assert.equal(
          JSON.parse(readFileSync(join(root, 'posted.json'), 'utf8')).state,
          expected,
          result.stdout + result.stderr,
        );
        assert.equal(
          result.status,
          expected === 'failure' ? 1 : 0,
          result.stdout + result.stderr,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
