import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// Shared ephemeral-Postgres harness for the REDVAULT migration test
// runners. Behavior mirrors the inline setup the runners previously
// duplicated: a private unix-socket cluster with trust auth, a throwing
// synchronous `sql` helper, and a promise-based `concurrentSql` helper
// for race cases.
export function createRedvaultEphemeralCluster({ prefix, port }) {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  chmodSync(root, 0o700);

  function run(name, args, input) {
    const result = spawnSync(`/opt/homebrew/bin/${name}`, args, {
      encoding: 'utf8',
      input,
      timeout: 60000,
    });
    if (result.status !== 0) {
      throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
    }
    return result.stdout;
  }

  function sql(input) {
    return run(
      'psql',
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        root,
        '-p',
        port,
        '-U',
        'postgres',
        '-d',
        'postgres',
      ],
      input
    );
  }

  function concurrentSql(input) {
    return new Promise((resolveResult, reject) => {
      const child = spawn('/opt/homebrew/bin/psql', [
        '-X',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        root,
        '-p',
        port,
        '-U',
        'postgres',
        '-d',
        'postgres',
      ]);
      let output = '';
      let error = '';
      child.stdout.on('data', (value) => {
        output += value;
      });
      child.stderr.on('data', (value) => {
        error += value;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolveResult(`${output}\n${error}`);
        else reject(new Error(error));
      });
      child.stdin.end(input);
    });
  }

  function start() {
    run('initdb', [
      '-D',
      resolve(root, 'data'),
      '-U',
      'postgres',
      '--auth=trust',
      '--no-locale',
    ]);
    run('pg_ctl', [
      '-D',
      resolve(root, 'data'),
      '-l',
      resolve(root, 'postgres.log'),
      '-o',
      `-k ${root} -p ${port} -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB`,
      '-w',
      'start',
    ]);
  }

  function stop() {
    run('pg_ctl', ['-D', resolve(root, 'data'), '-m', 'fast', '-w', 'stop']);
  }

  function remove() {
    rmSync(root, { force: true, recursive: true });
  }

  return { concurrentSql, port, remove, root, run, sql, start, stop };
}
