import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { scriptText } from './ci-step-script-text.mjs';

// The PostgreSQL 18 side of the hosted-free runner contract (the runner routing lives in
// ci-hosted-free-runner-contract.test.mjs): the scratch-database suites get their binaries installed on GitHub-hosted
// runners and only verified on the self-hosted CI server, and every PostgreSQL pin names the same release.
const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const INSTALLER = '.github/scripts/install-postgresql-hosted.sh';
// The steps that install PostgreSQL 18 for the scratch-database suites, and the DB Replay step, whose
// toolchain script installs it the same way before adding the Supabase CLI.
const REPLAY_STEP = ['quality-db-replay', 'Install Supabase replay toolchain'];
const POSTGRESQL_STEPS = [
  ['quality-disposable-sql', 'Install PostgreSQL client and server binaries'],
  ['quality-misc', 'Run PiggyVest legacy runbook SQL against scratch PostgreSQL'],
  ['quality-misc', 'Test cart quota guard staging and signed PostgREST'],
];
const INSTALLER_CALLERS = [...POSTGRESQL_STEPS, REPLAY_STEP];
const scriptOf = (job, name) => scriptText(workflow.jobs[job].steps.find((step) => step.name === name));

test('jobs that need PostgreSQL verify the pre-installed toolchain on the private runner', () => {
  const replay = scriptOf(...REPLAY_STEP);
  const afterGuard = replay.slice(replay.lastIndexOf('\nfi\n'));
  assert.match(afterGuard, /test -x \/usr\/lib\/postgresql\/18\/bin\/initdb/);
  // The suites start their own servers, so the server programs must be present and on the pinned release too.
  for (const program of ['pg_ctl', 'postgres', 'pg_isready']) {
    assert.match(afterGuard, new RegExp(`test -x /usr/lib/postgresql/18/bin/${program}\\n`), program);
  }
  assert.match(afterGuard, /\/usr\/lib\/postgresql\/18\/bin\/postgres --version \| grep -Eq '\^postgres /);
  // CLI 3.x is one executable in a versioned folder that the script also puts on PATH for the later steps.
  assert.doesNotMatch(replay, /supabase-go/);
  assert.match(afterGuard, /test -x "\$\{SUPABASE_CLI_DIR\}\/supabase"/);
  assert.match(afterGuard, /echo "\$\{SUPABASE_CLI_DIR\}" >> "\$GITHUB_PATH"/);
  assert.match(afterGuard, /supabase --version/);
  for (const [job, name] of INSTALLER_CALLERS) {
    const script = scriptOf(job, name);
    const guarded = script.slice(0, script.lastIndexOf('\nfi\n'));
    assert.match(guarded, /^ +bash \.github\/scripts\/install-postgresql-hosted\.sh$/m, `${job} / ${name} installs through the shared script`);
    assert.match(script.slice(script.lastIndexOf('\nfi\n')), /test -x \/usr\/lib\/postgresql\/18\/bin\/initdb/, `${job} / ${name}`);
  }
  // The scratch-database suites run on these same binaries, so each install step also checks the release they report:
  // a server with older binaries would otherwise run the suites silently, and only DB Replay would notice.
  for (const [job, name] of POSTGRESQL_STEPS) {
    const script = scriptOf(job, name);
    const afterInstall = script.slice(script.lastIndexOf('\nfi\n'));
    // Every suite starts its own server with initdb and pg_ctl, so a server missing either fails here, not inside a suite.
    assert.match(afterInstall, /^test -x \/usr\/lib\/postgresql\/18\/bin\/pg_ctl$/m, `${job} / ${name} checks that pg_ctl exists`);
    assert.match(afterInstall, /^\/usr\/lib\/postgresql\/18\/bin\/postgres --version \| grep -Eq '\^postgres /m, `${job} / ${name} checks the postgres release`);
    assert.match(afterInstall, /^\/usr\/lib\/postgresql\/18\/bin\/psql --version \| grep -Eq '\^psql /m, `${job} / ${name} checks the psql release`);
  }
});

// Every file, whatever its extension, so a new workflow, action, script, SQL harness or helper cannot bring PostgreSQL 16 back.
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

test('nothing under .github or supabase/tests uses PostgreSQL 16 any more; every PG_BIN is PostgreSQL 18', () => {
  const files = [...filesUnder('.github'), ...filesUnder('supabase/tests')];
  assert.ok(files.includes('.github/workflows/ci.yml') && files.includes(INSTALLER), 'the scan must cover the workflow and the installer');
  const pgBins = new Set();
  for (const file of files) {
    const content = readFileSync(file);
    // A binary file (an image, an archive) cannot name a package, and decoding it as text only invites false matches.
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    assert.doesNotMatch(text, /postgresql[-/]16\b/, `${file} must not use PostgreSQL 16`);
    // Only workflows and actions set PG_BIN; test files mention it inside patterns.
    if (/\.ya?ml$/.test(file)) for (const match of text.matchAll(/\bPG_BIN(?:DIR)?: (\S+)/g)) pgBins.add(match[1]);
  }
  assert.deepEqual([...pgBins], ['/usr/lib/postgresql/18/bin']);
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
});

test('every PostgreSQL 18 pin names the same release: hosted install, psql check, replay contract, service container', async () => {
  const script = scriptOf(...REPLAY_STEP);
  // The shared installer is the one place the hosted build is pinned; a second copy could drift.
  const installer = await readFile(INSTALLER, 'utf8');
  const build = /^PG_BUILD='18\.(\d+)-1\.pgdg24\.04\+\d+'$/m.exec(installer);
  assert.ok(build, 'the installer must define PG_BUILD as an exact PostgreSQL 18 build');
  assert.match(installer, /"postgresql-18=\$\{PG_BUILD\}" "postgresql-client-18=\$\{PG_BUILD\}"/, 'server and client must both use PG_BUILD');
  assert.doesNotMatch(script, /postgresql(?:-client)?-18=/, 'the replay toolchain script must install PostgreSQL through the shared installer, not pin its own copy');
  // Two checks name the release: `psql --version` and `postgres --version` (a runner can have a new client next to an old server).
  const checkedAll = [...script.matchAll(/PostgreSQL\\\) 18\\\.(\d+)\(/g)].map((match) => match[1]);
  const checked = checkedAll[0];
  assert.equal(checkedAll.length, 2, 'both the psql and the postgres version checks must exist');
  assert.deepEqual([...new Set(checkedAll)], [build[1]], 'the psql and postgres version checks must match the pinned release');
  // The scratch-database install steps check the release of the binaries they use: postgres and psql, both the pinned one.
  for (const [job, name] of POSTGRESQL_STEPS) {
    const stepChecks = [...scriptOf(job, name).matchAll(/PostgreSQL\\\) 18\\\.(\d+)\(/g)].map((match) => match[1]);
    assert.deepEqual(stepChecks, [build[1], build[1]], `${job} / ${name} must check the pinned release for postgres and psql`);
  }
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

test('the shared PostgreSQL installer refuses to run before any privileged command outside a hosted runner', async () => {
  const lines = (await readFile(INSTALLER, 'utf8')).split('\n').filter((line) => !/^\s*#/.test(line));
  const guard = lines.findIndex((line) => line.includes('"${RUNNER_ENVIRONMENT:-}" != "github-hosted"'));
  const firstCommand = lines.findIndex((line) => /\b(sudo|apt-get|curl|gpg)\b/.test(line));
  assert.ok(guard >= 0, 'the installer must check RUNNER_ENVIRONMENT');
  assert.ok(guard < firstCommand, 'the hosted-runner check must come before the first command that installs or downloads');
  assert.match(lines.slice(guard, guard + 4).join('\n'), /exit 1/);
});
