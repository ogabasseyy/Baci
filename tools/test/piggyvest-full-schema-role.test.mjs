import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const bin = '/opt/homebrew/opt/postgresql@18/bin';
const environment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };

test('a nonsuperuser role creator needs explicit SET permission, while the probe remains unprivileged', () => {
  const directory = mkdtempSync('/tmp/baci-piggyvest-role.');
  const data = join(directory, 'data');
  const socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  let started = false;
  function run(command, args, input) {
    return spawnSync(join(bin, command), args, {
      input,
      encoding: 'utf8',
      env: environment,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  }
  function success(result) {
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  function sql(user, input) {
    return run(
      'psql',
      [
        '-X',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=sqlstate',
        '-At',
        '-h',
        socket,
        '-p',
        '55459',
        '-U',
        user,
        '-d',
        'postgres',
      ],
      input
    );
  }
  try {
    success(
      run('initdb', [
        '-D',
        data,
        '-A',
        'trust',
        '-U',
        'harness_admin',
        '--no-locale',
        '--encoding=UTF8',
      ])
    );
    success(
      run('pg_ctl', [
        '-D',
        data,
        '-o',
        `-k '${socket}' -h '' -p 55459`,
        '-l',
        join(directory, 'postgres.log'),
        'start',
      ])
    );
    started = true;
    success(
      sql(
        'harness_admin',
        'CREATE ROLE synthetic_replay LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB;'
      )
    );
    const wrapper = readFileSync(
      new URL('./piggyvest-full-schema-check.sql', import.meta.url),
      'utf8'
    );
    const create = wrapper.match(
      /^CREATE ROLE piggyvest_full_probe .+;$/m
    )?.[0];
    const grant = wrapper.match(
      /DO \$\$ BEGIN\n {2}EXECUTE format\([^\n]+\);\nEND \$\$;/
    )?.[0];
    assert.ok(create);
    assert.ok(grant);
    const original = sql(
      'synthetic_replay',
      `BEGIN;\n${create}\nSET LOCAL ROLE piggyvest_full_probe;\nROLLBACK;`
    );
    assert.notEqual(original.status, 0);
    assert.match(original.stderr, /42501/);
    assert.equal(
      success(
        sql(
          'harness_admin',
          "SELECT count(*) FROM pg_roles WHERE rolname='piggyvest_full_probe';"
        )
      ).trim(),
      '0'
    );
    const fixed = success(
      sql(
        'synthetic_replay',
        `
BEGIN;
${create}
${grant}
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='piggyvest_full_probe'
  AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb OR rolcanlogin))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='piggyvest_full_probe'::regrole)
  THEN RAISE EXCEPTION 'probe elevated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_auth_members
  WHERE roleid='piggyvest_full_probe'::regrole AND member=current_user::regrole
  AND set_option AND NOT inherit_option) THEN RAISE EXCEPTION 'wrong membership direction or options'; END IF;
END $$;
SET LOCAL ROLE piggyvest_full_probe;
SELECT current_user='piggyvest_full_probe' AND session_user='synthetic_replay';
RESET ROLE;
ROLLBACK;
SELECT count(*) FROM pg_roles WHERE rolname='piggyvest_full_probe';
`
      )
    );
    assert.match(fixed, /\nt\n/);
    assert.match(fixed, /\n0\n$/);
    const privileged = success(
      sql(
        'harness_admin',
        `BEGIN;\n${create}\nSET LOCAL ROLE piggyvest_full_probe;\nSELECT current_user;\nROLLBACK;`
      )
    );
    assert.match(privileged, /\npiggyvest_full_probe\n/);
  } finally {
    if (started) {
      const stopped = run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
      assert.equal(
        stopped.status,
        0,
        `Owned cluster cleanup failed; retained ${directory}`
      );
    }
    rmSync(directory, { recursive: true });
    assert.throws(() => readFileSync(join(data, 'PG_VERSION')));
    process.stdout.write(
      `Owned role-regression cluster removed: ${directory}\n`
    );
  }
});
