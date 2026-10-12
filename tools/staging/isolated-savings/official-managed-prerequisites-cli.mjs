import { spawnSync } from 'node:child_process';
import { officialManagedPrerequisites } from './official-managed-prerequisites.mjs';

try {
  const [
    mode,
    identifierFlag,
    systemIdentifier,
    reviewFlag,
    socketFlag,
    socket,
  ] = process.argv.slice(2);
  if (
    !['--sql', '--apply'].includes(mode) ||
    identifierFlag !== '--system-identifier' ||
    reviewFlag !== '--schema-only-reviewed' ||
    (mode === '--sql' && process.argv.length !== 6) ||
    (mode === '--apply' &&
      (process.argv.length !== 8 ||
        socketFlag !== '--socket' ||
        typeof socket !== 'string' ||
        !/^\/[A-Za-z0-9_./-]+$/.test(socket) ||
        socket.includes('..')))
  )
    throw new Error('Invalid arguments');
  const { sql } = officialManagedPrerequisites({
    systemIdentifier,
    schemaOnlyReviewed: true,
  });
  if (mode === '--sql') process.stdout.write(sql);
  else {
    const result = spawnSync(
      'psql',
      [
        '-X',
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--host',
        socket,
        '--port',
        '5432',
        '--username',
        'postgres',
        '--dbname',
        'postgres',
      ],
      {
        input: sql,
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          LANG: 'C',
          PGAPPNAME: 'official-managed-prerequisites',
        },
      }
    );
    if (result.error || result.status !== 0)
      throw new Error('Managed prerequisite transaction failed');
    process.stdout.write(
      'Official managed schema-only prerequisites verified; operational Realtime unsupported.\n'
    );
  }
} catch {
  process.stderr.write(
    'Official managed prerequisites rejected or rolled back. Check isolated identity, startup containment and prerequisites; no automatic retry.\n'
  );
  process.exitCode = 1;
}
