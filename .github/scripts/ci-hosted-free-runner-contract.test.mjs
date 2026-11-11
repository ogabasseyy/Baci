import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
const INSTALLER = '.github/scripts/install-postgresql-hosted.sh';
// The shared PostgreSQL installer runs sudo and apt-get itself, so calling it counts as privileged too.
const PRIVILEGED_COMMAND = /\b(sudo|apt-get)\b|install-postgresql-hosted\.sh/;
// The steps that install PostgreSQL 18 for the scratch-database suites, and the DB Replay step, whose
// toolchain script installs it the same way before adding the Supabase CLI.
const REPLAY_STEP = ['quality-db-replay', 'Install Supabase replay toolchain'];
const POSTGRESQL_STEPS = [
  ['quality-disposable-sql', 'Install PostgreSQL client and server binaries'],
  ['quality-misc', 'Run PiggyVest legacy runbook SQL against scratch PostgreSQL'],
  ['quality-misc', 'Test cart quota guard staging and signed PostgREST'],
];
const INSTALLER_CALLERS = [...POSTGRESQL_STEPS, REPLAY_STEP];
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
  const replay = scriptOf(...REPLAY_STEP);
  const afterGuard = replay.slice(replay.lastIndexOf('\nfi\n'));
  assert.match(afterGuard, /test -x \/usr\/local\/bin\/supabase-go/);
  assert.match(afterGuard, /supabase --version/);
  for (const [job, name] of INSTALLER_CALLERS) {
    const script = scriptOf(job, name);
    const guarded = script.slice(0, script.lastIndexOf('\nfi\n'));
    assert.match(guarded, /^ +bash \.github\/scripts\/install-postgresql-hosted\.sh$/m, `${job} / ${name} installs through the shared script`);
    assert.match(script.slice(script.lastIndexOf('\nfi\n')), /test -x \/usr\/lib\/postgresql\/18\/bin\/initdb/, `${job} / ${name}`);
  }
});

test('no CI step or install script uses PostgreSQL 16 any more; every PG_BIN is PostgreSQL 18', async () => {
  for (const file of ['.github/workflows/ci.yml', INSTALLER, '.github/scripts/install-supabase-replay-toolchain.sh']) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /postgresql[-/]16\b/, `${file} must not use PostgreSQL 16`);
  }
  const text = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.deepEqual([...new Set([...text.matchAll(/PG_BIN: (\S+)/g)].map((match) => match[1]))], ['/usr/lib/postgresql/18/bin']);
});

test('the shared PostgreSQL installer is called only by the PostgreSQL install steps and DB Replay', () => {
  const callers = [];
  for (const [job, definition] of Object.entries(workflow.jobs)) {
    for (const step of definition.steps ?? []) {
      // A step may call the installer itself or through the script it runs (DB Replay).
      if (typeof step.run === 'string' && (step.run.includes(INSTALLER) || scriptText(step).includes(INSTALLER))) callers.push({ job, name: step.name });
    }
  }
  assert.deepEqual(callers.map(({ job, name }) => [job, name]).sort(), [...INSTALLER_CALLERS].sort());
  // A caller outside a private job would escape the hosted-guard check above.
  for (const { job, name } of callers) assert.ok(PRIVATE_JOBS.includes(job), `${job} / ${name} must be covered by the hosted-guard test`);
});

test('every PostgreSQL 18 pin names the same release: hosted install, psql check, replay contract, service container', async () => {
  const script = scriptText(workflow.jobs[REPLAY_STEP[0]].steps.find((step) => step.name === REPLAY_STEP[1]));
  // The shared installer is the one place the hosted build is pinned; a second copy could drift.
  const installer = await readFile(INSTALLER, 'utf8');
  const build = /^PG_BUILD='18\.(\d+)-1\.pgdg24\.04\+\d+'$/m.exec(installer);
  assert.ok(build, 'the installer must define PG_BUILD as an exact PostgreSQL 18 build');
  assert.match(installer, /"postgresql-18=\$\{PG_BUILD\}" "postgresql-client-18=\$\{PG_BUILD\}"/, 'server and client must both use PG_BUILD');
  assert.doesNotMatch(script, /postgresql(?:-client)?-18=/, 'the replay toolchain script must install PostgreSQL through the shared installer, not pin its own copy');
  const checked = /PostgreSQL\\\) 18\\\.(\d+)\(/.exec(script)?.[1];
  assert.equal(build[1], checked, 'the psql version check must match the pinned release');
  // The replay tool asserts the psql version again before any replay; a stale value there fails every replay.
  const contract = readFileSync('apps/web/tools/db/supabase-replay-contract.ts', 'utf8');
  assert.equal(/PostgreSQL\\\) 18\\\.(\d+)\(/.exec(contract)?.[1], checked, 'apps/web/tools/db/supabase-replay-contract.ts must accept the same psql release');
  const image = workflow.jobs['quality-disposable-sql'].services.postgres.image;
  assert.match(image, new RegExp(`^postgres:18\\.${checked}@sha256:[0-9a-f]{64}$`), 'the Disposable SQL database container must use the same release, pinned by digest');
});

test('the shared PostgreSQL installer refuses to run before any privileged command outside a hosted runner', async () => {
  const lines = (await readFile(INSTALLER, 'utf8')).split('\n').filter((line) => !/^\s*#/.test(line));
  const guard = lines.findIndex((line) => line.includes('"${RUNNER_ENVIRONMENT:-}" != "github-hosted"'));
  const firstCommand = lines.findIndex((line) => /\b(sudo|apt-get|curl|gpg)\b/.test(line));
  assert.ok(guard >= 0, 'the installer must check RUNNER_ENVIRONMENT');
  assert.ok(guard < firstCommand, 'the hosted-runner check must come before the first command that installs or downloads');
  assert.match(lines.slice(guard, guard + 4).join('\n'), /exit 1/);
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
  const prune = steps.find((step) => step.name === 'Prune an oversized persistent pnpm store');
  assert.equal(prune.if, "steps.pnpm-store.outputs.persistent == 'true'");
  assert.match(prune.run, /pnpm store prune/);
  assert.ok(steps.indexOf(configure) < steps.indexOf(prune) && steps.indexOf(prune) < steps.findIndex((step) => step.name === 'Install Dependencies'));
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
