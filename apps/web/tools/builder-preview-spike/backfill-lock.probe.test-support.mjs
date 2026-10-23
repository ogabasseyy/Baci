/** PostgreSQL cutover-lock mechanism check; synthetic schema in owned replay only. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const workdir = realpathSync(process.env.BACI_TASK0_REPLAY_WORKDIR ?? '');
assert(path.basename(workdir).startsWith('baci-supabase-replay-'));
const owner = JSON.parse(
  readFileSync(path.join(workdir, '.baci-supabase-replay-owner.json'), 'utf8')
);
assert.equal(owner.workdir, workdir);
assert.match(owner.projectId, /^baci_replay_[a-f0-9]{24}$/);
const db = `supabase_db_${owner.projectId}`;
const prefix = `task0_cutover_${randomUUID().replaceAll('-', '')}`;
const sql = (input) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      db,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', timeout: 10000 }
  );
assert.equal(sql('SHOW server_version_num').trim(), '170006');
const children = [];
function session(name) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      db,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
  child.stdin.write(`SET application_name='${name}';\n`);
  const actor = { child, closed, read: () => output };
  children.push(actor);
  return actor;
}
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await setTimeout(25);
  }
  throw new Error('Owned cutover actor did not reach expected lock phase');
}
function cleanup() {
  for (const actor of children) {
    if (!actor.child.stdin.writableEnded) actor.child.stdin.end('ROLLBACK;\n');
    actor.child.kill('SIGTERM');
  }
  sql(`DROP SCHEMA IF EXISTS ${prefix} CASCADE;`);
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    cleanup();
    process.exit(143);
  });
try {
  sql(
    `CREATE SCHEMA ${prefix}; CREATE TABLE ${prefix}.page_configs(id int PRIMARY KEY,draft_config jsonb,published_config jsonb); CREATE TABLE ${prefix}.builder_page_drafts(id int PRIMARY KEY,draft_config jsonb); INSERT INTO ${prefix}.page_configs VALUES(1,'{"copy":"ORIGINAL"}','{"copy":"PUBLIC"}');`
  );
  const writer = session(`${prefix}_writer`);
  writer.child.stdin.write(
    `BEGIN; UPDATE ${prefix}.page_configs SET draft_config='{"copy":"COMMITTED-BEFORE-CUTOVER"}' WHERE id=1;\n\\echo WRITER_HELD\n`
  );
  await until(() => writer.read().includes('WRITER_HELD'));
  const cutover = session(`${prefix}_cutover`);
  cutover.child.stdin.write(
    `BEGIN; LOCK TABLE ${prefix}.page_configs IN ACCESS EXCLUSIVE MODE; LOCK TABLE ${prefix}.builder_page_drafts IN ACCESS EXCLUSIVE MODE; INSERT INTO ${prefix}.builder_page_drafts SELECT id,draft_config FROM ${prefix}.page_configs;\n\\echo CUTOVER_HELD\n`
  );
  await until(
    () =>
      sql(
        `SELECT count(*) FROM pg_stat_activity WHERE application_name='${prefix}_cutover' AND wait_event_type='Lock';`
      ).trim() === '1'
  );
  writer.child.stdin.end('COMMIT;\n');
  assert.equal((await writer.closed).code, 0);
  await until(() => cutover.read().includes('CUTOVER_HELD'));
  const late = session(`${prefix}_late`);
  late.child.stdin.end(
    `UPDATE ${prefix}.page_configs SET draft_config='{"copy":"LATE"}' WHERE id=1;\n`
  );
  await until(
    () =>
      sql(
        `SELECT count(*) FROM pg_stat_activity WHERE application_name='${prefix}_late' AND wait_event_type='Lock';`
      ).trim() === '1'
  );
  cutover.child.stdin.end(
    `ALTER TABLE ${prefix}.page_configs DROP COLUMN draft_config; COMMIT;\n`
  );
  assert.equal((await cutover.closed).code, 0);
  const blocked = await late.closed;
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.errors, /column "draft_config".*does not exist/);
  assert.equal(
    sql(
      `SELECT draft_config->>'copy' FROM ${prefix}.builder_page_drafts WHERE id=1;`
    ).trim(),
    'COMMITTED-BEFORE-CUTOVER'
  );
  assert.equal(
    sql(
      `SELECT published_config->>'copy' FROM ${prefix}.page_configs WHERE id=1;`
    ).trim(),
    'PUBLIC'
  );
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        scope:
          'Real PostgreSQL lock/backfill/contraction mechanism in isolated synthetic schema',
        checks: [
          'pre-lock committed writer captured',
          'cutover waits for writer',
          'late legacy writer blocked then fails closed',
          'published projection preserved',
        ],
      },
      null,
      2
    )
  );
} finally {
  cleanup();
}
