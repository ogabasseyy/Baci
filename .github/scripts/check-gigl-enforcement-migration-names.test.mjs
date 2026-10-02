import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..', '..');
const checkScript = join(
  scriptsDir,
  'check-gigl-enforcement-migration-names.sh'
);

function runCheck(files) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-gigl-migration-names-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(directory, name), body);
    }
    return spawnSync('bash', [checkScript, directory], { encoding: 'utf8' });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('check-gigl-enforcement-migration-names', () => {
  it('passes clean, gigl-named, and table-only migrations', () => {
    const result = runCheck({
      '20260101000000_add_orders_index.sql':
        'CREATE INDEX orders_idx ON orders (id);\n',
      '20260102000000_gigl_hook_tightening.sql':
        'ALTER FUNCTION enforce_gigl_tracking_worker_request_scope() SECURITY DEFINER;\n',
      '20260103000000_gigl_monitor_columns.sql':
        'ALTER TABLE gigl_tracking_monitors ADD COLUMN note text;\n',
      '20260104000000_monitor_retention.sql':
        'DELETE FROM gigl_tracking_monitors WHERE retired_at < now();\n',
    });

    assert.equal(result.status, 0, result.stderr);
  });

  it('fails a hook change without gigl in the filename', () => {
    const result = runCheck({
      '20260105000000_alter_auth_hook.sql':
        'CREATE OR REPLACE FUNCTION enforce_gigl_tracking_worker_request_scope() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;\n',
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /must carry gigl in its filename: .*20260105000000_alter_auth_hook\.sql/
    );
  });

  it('fails a worker-role grant change without gigl in the filename', () => {
    const result = runCheck({
      '20260106000000_grant_cleanup.sql':
        'GRANT gigl_tracking_worker TO authenticator;\n',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /20260106000000_grant_cleanup\.sql/);
  });

  it('fails a wrapper change without gigl in the filename', () => {
    const result = runCheck({
      '20260107000000_rpc_perf.sql':
        'ALTER FUNCTION gigl_worker_claim(integer) SET statement_timeout = 5000;\n',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /20260107000000_rpc_perf\.sql/);
  });

  it('treats uppercase GIGL as unnamed (the tracking glob is case-sensitive)', () => {
    const result = runCheck({
      '20260108000000_GIGL_hook.sql':
        'ALTER FUNCTION enforce_gigl_tracking_worker_request_scope() OWNER TO postgres;\n',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /20260108000000_GIGL_hook\.sql/);
  });

  it('is wired into CI and the deploy-scripts filter', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const filter = readFileSync(
      join(repoRoot, '.github', 'filters', 'ci.yml'),
      'utf8'
    );

    assert.match(
      workflow,
      /bash \.github\/scripts\/check-gigl-enforcement-migration-names\.sh/
    );
    assert.match(
      filter,
      /'\.github\/scripts\/check-gigl-enforcement-migration-names\.sh'/
    );
    assert.match(
      filter,
      /'\.github\/scripts\/check-gigl-enforcement-migration-names\.test\.mjs'/
    );
  });
});
