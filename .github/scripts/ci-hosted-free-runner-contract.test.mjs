import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const PRIVATE = ['self-hosted', 'Linux', 'X64', 'baci-private-ci'];
const MOVED_BY_NEEDS = ['cwv-runner-contracts', 'quality-db-replay', 'quality-disposable-sql', 'quality-misc', 'mobile-quality'];
const MOVED_INLINE = ['changes', 'silent-revert-guard', 'quality'];

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

test('the changes job trust rule matches the private_ci_trusted output', () => {
  const trusted = workflow.jobs.changes.outputs.private_ci_trusted.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const runsOn = workflow.jobs.changes['runs-on'];
  assert.ok(runsOn.includes(trusted), 'changes runs-on must reuse the exact trust expression');
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
  const base = { 'github.event_name': 'push' };
  assert.deepEqual(privateRunnerRoute(workflow, 'quality-quiz-approval', { ...values(), ...base }), ['self-hosted', 'Linux', 'X64', 'baci-deploy']);
  assert.equal(privateRunnerRoute(workflow, 'quality-quiz-approval', { ...values(), 'github.event_name': 'merge_group' }), 'ubuntu-24.04');
});

const PRIVATE_JOBS = [...MOVED_BY_NEEDS, ...MOVED_INLINE, 'quality-lint', 'quality-typecheck', 'quality-test', 'quality-test-web', 'build'];
const PRIVILEGED_COMMAND = /\b(sudo|apt-get)\b/;
const HOSTED_GUARD = /^(\s*)if \[ "\$RUNNER_ENVIRONMENT" = 'github-hosted' \]; then\s*$/;

function privilegedLinesOutsideHostedGuard(step) {
  if (typeof step.run !== 'string') return [];
  if (typeof step.if === 'string' && step.if.includes("runner.environment == 'github-hosted'")) return [];
  const lines = step.run.split('\n');
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
  const scriptOf = (job, name) => workflow.jobs[job].steps.find((step) => step.name === name).run;
  const replay = scriptOf('quality-db-replay', 'Install Supabase replay toolchain');
  const afterGuard = replay.slice(replay.lastIndexOf('\nfi\n'));
  assert.match(afterGuard, /test -x \/usr\/lib\/postgresql\/18\/bin\/initdb/);
  assert.match(afterGuard, /test -x \/usr\/local\/bin\/supabase-go/);
  assert.match(afterGuard, /supabase --version/);
  for (const [job, name] of [['quality-disposable-sql', 'Install PostgreSQL client and server binaries'], ['quality-misc', 'Run PiggyVest legacy runbook SQL against scratch PostgreSQL'], ['quality-misc', 'Test cart quota guard staging and signed PostgREST']]) {
    const script = scriptOf(job, name);
    assert.match(script.slice(script.lastIndexOf('\nfi\n')), /test -x \/usr\/lib\/postgresql\/16\/bin\/initdb/, `${job} / ${name}`);
  }
});

test('the hosted PostgreSQL 18 pin and the psql version check name the same release', () => {
  const script = workflow.jobs['quality-db-replay'].steps.find((step) => step.name === 'Install Supabase replay toolchain').run;
  const pinned = new Set([...script.matchAll(/postgresql(?:-client)?-18=18\.(\d+)-1\.pgdg24\.04\+\d+/g)].map((match) => match[1]));
  const checked = /PostgreSQL\\\) 18\\\.(\d+)\(/.exec(script)?.[1];
  assert.equal(pinned.size, 1, 'server and client packages must pin the same minor release');
  assert.equal([...pinned][0], checked, 'the psql version check must match the pinned release');
});

test('the private runner keeps a persistent pnpm store and skips the GitHub cache download', async () => {
  const action = YAML.parse(await readFile('.github/actions/pnpm-install-cached/action.yml', 'utf8'));
  const steps = action.runs.steps;
  const select = steps.find((step) => step.id === 'pnpm-store');
  const restore = steps.find((step) => step.id === 'pnpm-store-cache');
  const configure = steps.find((step) => step.name === 'Configure pnpm store directory');
  assert.match(select.env.PERSISTENT_RUNNER, /runner\.environment == 'self-hosted' && startsWith\(runner\.name, 'contabo-baci-ci'\)/);
  assert.equal(select.env.TOOL_CACHE, '${{ runner.tool_cache }}');
  assert.equal(restore.if, "steps.pnpm-store.outputs.persistent != 'true'");
  assert.equal(configure.env.STORE_DIR, '${{ steps.pnpm-store.outputs.dir }}');
  assert.ok(steps.indexOf(select) < steps.indexOf(restore));
  const run = (persistent, storeDir) => {
    const out = spawnSync('bash', ['-c', `${select.run}\ncat "$GITHUB_OUTPUT"`], {
      encoding: 'utf8',
      env: { ...process.env, PERSISTENT_RUNNER: persistent, STORE_DIR: storeDir, TOOL_CACHE: tmpdir(), GITHUB_OUTPUT: join(tmpdir(), `out-${process.pid}-${persistent}-${storeDir.replace(/\W/g, '_')}`) },
    });
    return out.stdout;
  };
  assert.equal(run('true', '.pnpm-store'), `persistent=true\ndir=${tmpdir()}/pnpm-store\n`);
  assert.equal(run('false', '.pnpm-store'), 'persistent=false\ndir=.pnpm-store\n');
  assert.equal(run('true', '/custom/store'), 'persistent=false\ndir=/custom/store\n');
});
