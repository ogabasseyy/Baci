import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const PRIVATE = ['self-hosted', 'Linux', 'X64', 'baci-private-ci'];

// A step that only calls `bash .github/scripts/<name>.sh` keeps its logic in that script, so check the script.
function scriptText(step) {
  const call = /^bash (\.github\/scripts\/[\w.-]+\.sh)$/.exec(typeof step.run === 'string' ? step.run.trim() : '');
  return call ? readFileSync(call[1], 'utf8') : step.run;
}
const MOVED_BY_NEEDS = ['cwv-runner-contracts', 'quality-db-replay', 'quality-disposable-sql', 'quality-misc', 'mobile-quality'];
const MOVED_INLINE = ['silent-revert-guard', 'quality'];

function values({ privateRepo = true, enabled = 'true', event = 'pull_request', head = 'owner/repo' } = {}) {
  return {
    'github.event.repository.private': privateRepo,
    'vars.BACI_PRIVATE_CI_ENABLED': enabled,
    'github.event_name': event,
    'github.event.pull_request.head.repo.full_name': head,
    'github.repository': 'owner/repo',
  };
}
const route = (job, overrides) => privateRunnerRoute(workflow, job, values(overrides));
const untrusted = [{ privateRepo: false }, { privateRepo: null }, { enabled: '' }, { enabled: 'false' }, { head: 'other/fork' }, { head: '' }, { event: 'merge_group' }, { event: 'pull_request_target' }, { event: 'issue_comment' }];

test('every job a required check depends on can run on the private runner for trusted events', () => {
  for (const job of [...MOVED_BY_NEEDS, ...MOVED_INLINE]) {
    assert.deepEqual(route(job), PRIVATE, job);
    for (const event of ['push', 'workflow_dispatch']) {
      assert.deepEqual(route(job, { event, head: '' }), PRIVATE, `${job} ${event}`);
    }
  }
});

test('forks, untrusted events and a disabled switch stay on GitHub-hosted runners', () => {
  for (const job of [...MOVED_BY_NEEDS, ...MOVED_INLINE]) {
    for (const override of untrusted) {
      assert.equal(route(job, override), 'ubuntu-24.04', `${job} ${JSON.stringify(override)}`);
    }
  }
});

test('the inline trust predicates match the private_ci_trusted output token for token', () => {
  // silent-revert-guard and the Quality Gate aggregate cannot need `changes`, so they spell the predicate out.
  const normalize = (text) => text.replace(/\$\{\{|\}\}/g, '').replace(/\s+/g, ' ').trim();
  const trusted = normalize(workflow.jobs.changes.outputs.private_ci_trusted);
  for (const job of MOVED_INLINE) {
    assert.ok(normalize(workflow.jobs[job]['runs-on']).includes(trusted), `${job} must spell the same trust predicate as changes.outputs.private_ci_trusted`);
  }
});

test('Disposable SQL never publishes a fixed host port, so concurrent jobs on one server cannot collide', () => {
  const job = workflow.jobs['quality-disposable-sql'];
  assert.deepEqual(job.services.postgres.ports, [5432], 'let Docker assign the host port');
  const users = job.steps.filter((step) => step.env?.PGHOST === 'localhost');
  assert.ok(users.length >= 3);
  for (const step of users) {
    assert.equal(step.env.PGPORT, "${{ job.services.postgres.ports['5432'] }}", step.name);
  }
});

test('the changes job holds the capability gate, so it stays a plain unconditional ubuntu-24.04 job', () => {
  // The base-owned capability-gate contract (capability_gate_contract_ci_checks.py) fails the PR otherwise.
  const job = workflow.jobs.changes;
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  for (const key of ['if', 'needs', 'continue-on-error', 'container', 'uses', 'env']) {
    assert.equal(Object.hasOwn(job, key), false, `changes must not set ${key}`);
  }
  assert.ok(job.steps.some((step) => step.uses === './.github/actions/capability-gate'));
  assert.match(job.outputs.private_ci_trusted, /github\.event\.repository\.private/);
});

test('no job on the general private runner references repository secrets', () => {
  for (const job of ['changes', 'silent-revert-guard', 'quality', 'cwv-runner-contracts', 'mobile-quality', 'quality-db-replay', 'quality-disposable-sql', 'quality-misc']) {
    assert.doesNotMatch(JSON.stringify(workflow.jobs[job]), /\bsecrets\./, job);
  }
});

test('the Supabase service-role step lives only in a main-push job on the deploy runner', () => {
  const holders = Object.entries(workflow.jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.SUPABASE_SERVICE_ROLE_KEY'));
  assert.deepEqual(holders.map(([name]) => name), ['quality-quiz-approval']);
  const job = workflow.jobs['quality-quiz-approval'];
  assert.match(job.if, /github\.ref == 'refs\/heads\/main'/);
  assert.ok(workflow.jobs.quality.needs.includes('quality-quiz-approval'));
  assert.deepEqual(route('quality-quiz-approval', { event: 'push', head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-deploy']);
  // The same kill switch as every private route: public repo, switch off, or any other event stays hosted.
  for (const override of [{ event: 'push', privateRepo: false }, { event: 'push', privateRepo: null }, { event: 'push', enabled: '' }, { event: 'push', enabled: 'false' }, { event: 'merge_group' }, { event: 'pull_request' }, { event: 'workflow_dispatch' }]) {
    assert.equal(route('quality-quiz-approval', override), 'ubuntu-24.04', JSON.stringify(override));
  }
});

const PRIVATE_JOBS = [...MOVED_BY_NEEDS, ...MOVED_INLINE, 'quality-lint', 'quality-typecheck', 'quality-test', 'quality-test-web', 'build'];
const PRIVILEGED_COMMAND = /\b(sudo|apt-get)\b/;
const HOSTED_GUARD = /^(\s*)if \[ "\$RUNNER_ENVIRONMENT" = 'github-hosted' \]; then\s*$/;

function privilegedLinesOutsideHostedGuard(step) {
  if (typeof step.run !== 'string') return [];
  if (typeof step.if === 'string' && step.if.includes("runner.environment == 'github-hosted'")) return [];
  const lines = scriptText(step).split('\n');
  const guarded = new Set();
  lines.forEach((line, index) => {
    const match = HOSTED_GUARD.exec(line);
    if (!match) return;
    const end = lines.findIndex((candidate, at) => at > index && candidate === `${match[1]}fi`);
    assert.ok(end > index, `hosted guard in "${step.name}" must be closed by a matching fi`);
    for (let at = index + 1; at < end; at += 1) guarded.add(at);
  });
  return lines.filter((line, index) => PRIVILEGED_COMMAND.test(line) && !/^\s*#/.test(line) && !guarded.has(index)).map((line) => line.trim());
}

test('privileged installs run only on GitHub-hosted runners; the self-hosted runner user has no sudo', () => {
  const offenders = [];
  for (const name of PRIVATE_JOBS) {
    for (const step of workflow.jobs[name].steps ?? []) {
      for (const line of privilegedLinesOutsideHostedGuard(step)) offenders.push(`${name} / ${step.name ?? step.uses}: ${line}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('jobs that need PostgreSQL verify the pre-installed toolchain on the private runner', () => {
  const scriptOf = (job, name) => scriptText(workflow.jobs[job].steps.find((step) => step.name === name));
  const replay = scriptOf('quality-db-replay', 'Install Supabase replay toolchain');
  const afterGuard = replay.slice(replay.lastIndexOf('\nfi\n'));
  assert.match(afterGuard, /test -x \/usr\/lib\/postgresql\/18\/bin\/initdb/);
  // The suites start their own servers, so the server programs must be present and on the pinned release too.
  for (const program of ['pg_ctl', 'postgres', 'pg_isready']) {
    assert.match(afterGuard, new RegExp(`test -x /usr/lib/postgresql/18/bin/${program}\\n`), program);
  }
  assert.match(afterGuard, /\/usr\/lib\/postgresql\/18\/bin\/postgres --version \| grep -Eq '\^postgres /);
  assert.match(afterGuard, /test -x \/usr\/local\/bin\/supabase-go/);
  assert.match(afterGuard, /supabase --version/);
  for (const [job, name] of [['quality-disposable-sql', 'Install PostgreSQL client and server binaries'], ['quality-misc', 'Run PiggyVest legacy runbook SQL against scratch PostgreSQL'], ['quality-misc', 'Test cart quota guard staging and signed PostgREST']]) {
    const script = scriptOf(job, name);
    assert.match(script.slice(script.lastIndexOf('\nfi\n')), /test -x \/usr\/lib\/postgresql\/16\/bin\/initdb/, `${job} / ${name}`);
  }
});

test('every PostgreSQL 18 pin names the same release: hosted install, psql check, replay contract, service container', () => {
  const script = scriptText(workflow.jobs['quality-db-replay'].steps.find((step) => step.name === 'Install Supabase replay toolchain'));
  const pinned = new Set([...script.matchAll(/postgresql(?:-client)?-18=18\.(\d+)-1\.pgdg24\.04\+\d+/g)].map((match) => match[1]));
  // Two checks name the release: `psql --version` and `postgres --version` (a runner can have a new client next to an old server).
  const checkedAll = [...script.matchAll(/PostgreSQL\\\) 18\\\.(\d+)\(/g)].map((match) => match[1]);
  const checked = checkedAll[0];
  assert.equal(pinned.size, 1, 'server and client packages must pin the same minor release');
  assert.equal(checkedAll.length, 2, 'both the psql and the postgres version checks must exist');
  assert.deepEqual([...new Set(checkedAll)], [...pinned], 'the psql and postgres version checks must match the pinned release');
  // The replay tool asserts the psql version again before any replay; a stale value there fails every replay.
  const contract = readFileSync('apps/web/tools/db/supabase-replay-contract.ts', 'utf8');
  assert.equal(/PostgreSQL\\\) 18\\\.(\d+)\(/.exec(contract)?.[1], checked, 'apps/web/tools/db/supabase-replay-contract.ts must accept the same psql release');
  const image = workflow.jobs['quality-disposable-sql'].services.postgres.image;
  assert.match(image, new RegExp(`^postgres:18\\.${checked}@sha256:[0-9a-f]{64}$`), 'the Disposable SQL database container must use the same release, pinned by digest');
  // A stale or mistyped digest still matches that format, so the job also asks the running container which release it is.
  const steps = workflow.jobs['quality-disposable-sql'].steps;
  const assertion = steps.find((step) => step.name === 'Assert the database container runs the pinned PostgreSQL release');
  assert.ok(assertion, 'the Disposable SQL job must check the release of the running database container');
  assert.equal(assertion.env.EXPECTED_SERVER_VERSION_NUM, String(180000 + Number(checked)), 'the container check must expect the pinned release as server_version_num');
  assert.match(assertion.run, /SHOW server_version_num/);
  assert.equal(steps.indexOf(assertion), 1, 'the container check runs first, right after checkout');
});

test('the private runner keeps a persistent pnpm store and skips the GitHub cache download', async () => {
  const action = YAML.parse(await readFile('.github/actions/pnpm-install-cached/action.yml', 'utf8'));
  const steps = action.runs.steps;
  const select = steps.find((step) => step.id === 'pnpm-store');
  const restore = steps.find((step) => step.id === 'pnpm-store-cache');
  const configure = steps.find((step) => step.name === 'Configure pnpm store directory');
  assert.match(select.env.PERSISTENT_RUNNER, /runner\.environment == 'self-hosted' && contains\(fromJSON\('\["contabo-baci-ci","contabo-baci-ci-2"\]'\), runner\.name\)/);
  assert.equal(select.env.TOOL_CACHE, '${{ runner.tool_cache }}');
  assert.equal(restore.if, "steps.pnpm-store.outputs.persistent != 'true'");
  assert.equal(configure.env.STORE_DIR, '${{ steps.pnpm-store.outputs.dir }}');
  assert.ok(steps.indexOf(select) < steps.indexOf(restore));
  const prune = steps.find((step) => step.name === 'Prune an oversized persistent pnpm store');
  assert.equal(prune.if, "steps.pnpm-store.outputs.persistent == 'true'");
  // The prune names the measured store explicitly and is housekeeping only: a failure warns instead of failing the job.
  assert.match(prune.run, /pnpm store prune --store-dir "\$STORE_DIR" \|\| echo "::warning::/);
  // Measuring the store is housekeeping too: an unreadable size skips the check instead of failing the job.
  assert.match(prune.run, /could not measure the pnpm store/);
  assert.ok(steps.indexOf(configure) < steps.indexOf(prune) && steps.indexOf(prune) < steps.findIndex((step) => step.name === 'Install Dependencies'));
  const run = (persistent, storeDir, runnerName = 'contabo-baci-ci') => {
    const out = spawnSync('bash', ['-c', `${select.run}\ncat "$GITHUB_OUTPUT"`], {
      encoding: 'utf8',
      env: { ...process.env, PERSISTENT_RUNNER: persistent, STORE_DIR: storeDir, RUNNER_NAME: runnerName, TOOL_CACHE: tmpdir(), GITHUB_OUTPUT: join(tmpdir(), `out-${process.pid}-${persistent}-${runnerName}-${storeDir.replace(/\W/g, '_')}`) },
    });
    return out.stdout;
  };
  assert.equal(run('true', '.pnpm-store'), `persistent=true\ndir=${tmpdir()}/pnpm-store-contabo-baci-ci\n`);
  // Each runner gets its own store directory, so two runners can never share or prune one store.
  assert.equal(run('true', '.pnpm-store', 'contabo-baci-ci-2'), `persistent=true\ndir=${tmpdir()}/pnpm-store-contabo-baci-ci-2\n`);
  assert.equal(run('false', '.pnpm-store'), 'persistent=false\ndir=.pnpm-store\n');
  assert.equal(run('true', '/custom/store'), 'persistent=false\ndir=/custom/store\n');
  const noName = spawnSync('bash', ['-c', select.run], {
    encoding: 'utf8',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'RUNNER_NAME')), PERSISTENT_RUNNER: 'true', STORE_DIR: '.pnpm-store', TOOL_CACHE: tmpdir(), GITHUB_OUTPUT: join(tmpdir(), `out-${process.pid}-no-name`) },
  });
  assert.notEqual(noName.status, 0, 'a persistent store without a runner name must fail instead of sharing one directory');
  // A persistent store inside the checkout would be wiped by `git clean`; the step must refuse it.
  const inside = spawnSync('bash', ['-c', select.run], {
    encoding: 'utf8',
    env: { ...process.env, PERSISTENT_RUNNER: 'true', STORE_DIR: '.pnpm-store', RUNNER_NAME: 'contabo-baci-ci', GITHUB_WORKSPACE: join(tmpdir(), 'ws'), TOOL_CACHE: join(tmpdir(), 'ws', 'tool'), GITHUB_OUTPUT: join(tmpdir(), `out-${process.pid}-inside`) },
  });
  assert.notEqual(inside.status, 0);
  assert.match(inside.stdout + inside.stderr, /outside the workspace/);
});

describe('bugfix: shared-host SQL tests must not share fixed /tmp files', () => {
  const script = readFileSync('supabase/tests/run-order-refund-claim-manual-concurrency-test.sh', 'utf8');

  test('the refund concurrency test has no fixed /tmp marker or log names', () => {
    // Two runner processes on one host can run this script at the same moment. With fixed names, one run deletes the
    // other run's lock-ready marker or truncates the log that its statement-timeout assertion reads.
    assert.doesNotMatch(script, /\/tmp\/order-refund-claim-race/);
  });

  test('every run gets its own scratch directory for the marker and the logs, and removes it on exit', () => {
    const setup = script.split('\n').filter((line) => /^(scratch_dir|HOLD_MARKER|SESSION_A_LOG|CLAIM_LOG)=/.test(line));
    assert.equal(setup.length, 4, 'scratch_dir, HOLD_MARKER, SESSION_A_LOG and CLAIM_LOG must each be one assignment line');
    const probe = `set -euo pipefail\n${setup.join('\n')}\nprintf '%s\\n%s\\n%s\\n%s\\n' "$scratch_dir" "$HOLD_MARKER" "$SESSION_A_LOG" "$CLAIM_LOG"`;
    const runs = [1, 2].map(() => {
      const result = spawnSync('bash', ['-c', probe], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim().split('\n');
    });
    try {
      assert.notEqual(runs[0][0], runs[1][0], 'two runs must not share a scratch directory');
      for (const [dir, ...files] of runs) {
        assert.ok(existsSync(dir), `${dir} must exist after setup`);
        for (const file of files) assert.ok(file.startsWith(`${dir}/`), `${file} must live inside ${dir}`);
      }
    } finally {
      for (const [dir] of runs) rmSync(dir, { recursive: true, force: true });
    }
    // The cleanup function also runs mid-script in full mode, so only the exit trap may remove the directory.
    assert.match(script, /^trap 'cleanup; rm -rf "\$scratch_dir"' EXIT$/m);
  });
});
