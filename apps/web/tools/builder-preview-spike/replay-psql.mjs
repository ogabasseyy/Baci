#!/usr/bin/env node
/** Pinned disposable replay client. Never connects to a host-supplied database. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function replayClientArgs(environment, containerNames, psqlArgs) {
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(environment.PGHOST) ||
    !/^\d{1,5}$/.test(environment.PGPORT ?? '') ||
    environment.PGDATABASE !== 'postgres' ||
    environment.PGUSER !== 'postgres' ||
    containerNames.length !== 1 ||
    !/^supabase_db_baci_replay_[a-f0-9]{24}$/.test(containerNames[0])
  )
    throw new Error(
      'Pinned client requires one owned loopback replay database'
    );
  return [
    'run',
    '--rm',
    '-i',
    '--network',
    `container:${containerNames[0]}`,
    '-e',
    'PGHOST',
    '-e',
    'PGPORT',
    '-e',
    'PGDATABASE',
    '-e',
    'PGUSER',
    '-e',
    'PGPASSWORD',
    '-e',
    'PGOPTIONS',
    'postgres:18.3',
    'psql',
    ...psqlArgs,
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    let args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--version') {
      process.stdout.write(
        execFileSync(
          'docker',
          [
            'run',
            '--rm',
            '--network',
            'none',
            'postgres:18.3',
            'psql',
            '--version',
          ],
          { encoding: 'utf8', timeout: 30000 }
        )
      );
    } else {
      const port = process.env.PGPORT;
      if (!/^\d{1,5}$/.test(port ?? ''))
        throw new Error('Missing owned replay port');
      const names = execFileSync(
        'docker',
        ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'],
        { encoding: 'utf8', timeout: 10000 }
      )
        .trim()
        .split('\n');
      let input;
      const fileIndex = args.indexOf('-f');
      if (fileIndex >= 0 && args[fileIndex + 1] !== '-') {
        input = readFileSync(args[fileIndex + 1]);
        args = args.map((value, index) =>
          index === fileIndex + 1 ? '-' : value
        );
      } else input = readFileSync(0);
      const dockerArgs = replayClientArgs(process.env, names, args);
      const output = execFileSync('docker', dockerArgs, {
        input,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120000,
        env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5432' },
      });
      process.stdout.write(output);
    }
  } catch {
    // The caller's bounded replay diagnostics report the stage. Do not serialize
    // an exec error carrying command input or generated local credentials.
    process.stderr.write('Owned replay PostgreSQL client failed\n');
    process.exitCode = 1;
  }
}
