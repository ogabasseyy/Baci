import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function createPrerequisitesTestDatabase({ image, socket, name }) {
  assert.match(socket, /^\/[A-Za-z0-9_./-]+$/);
  const docker = (args, input) =>
    spawnSync('docker', ['--host', `unix://${socket}`, ...args], {
      encoding: 'utf8',
      input,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  assert.equal(
    docker(['image', 'inspect', image, '--format', '{{.Id}}']).status,
    0,
    'Pinned image must be pre-pulled; tests never pull'
  );
  const start = docker([
    'run',
    '-d',
    '--pull',
    'never',
    '--network',
    'none',
    '--name',
    name,
    '--user',
    'postgres',
    '--tmpfs',
    '/tmp:rw,mode=1777',
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
    'initdb -D /tmp/managed-pg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/managed-pg -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements -c pg_stat_statements.track=none -c pg_stat_statements.track_utility=off -c cron.launch_active_jobs=off -c pg_net.database_name=baci_disabled_background -c wal_level=logical -c log_min_messages=panic',
  ]);
  assert.equal(start.status, 0, start.stderr);

  const query = (sql) =>
    docker(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        '/tmp',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ],
      sql
    );

  return {
    docker,
    query,
    cleanup: () =>
      assert.equal(
        docker(['rm', '-f', '-v', name]).status,
        0,
        'Disposable test container cleanup failed'
      ),
  };
}
