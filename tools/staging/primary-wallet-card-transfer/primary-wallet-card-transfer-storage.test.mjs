import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
const fixtures = 'apps/web/src/lib/piggyvest/';
test('isolated PostgreSQL scopes selector authority and fences concurrent claims and signed recovery', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'primary-card-transfer-pg-')
  );
  const database = path.join(directory, 'data');
  execFileSync('initdb', ['-D', database, '-A', 'trust', '--no-locale'], {
    stdio: 'pipe',
  });
  execFileSync(
    'pg_ctl',
    [
      '-D',
      database,
      '-l',
      path.join(directory, 'log'),
      '-o',
      `-k ${directory} -p 55479 -h ''`,
      '-w',
      'start',
    ],
    { stdio: 'pipe' }
  );
  const parameters = [
    '-h',
    directory,
    '-p',
    '55479',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
  ];
  try {
    await execute(
      'psql',
      [
        ...parameters,
        '-f',
        `${fixtures}primary-wallet-card-transfer-outbox.integration.sql`,
      ],
      { cwd: repository }
    );
    const attempts = await Promise.all(
      [0, 1].map(() =>
        execute(
          'psql',
          [
            ...parameters,
            '-f',
            `${fixtures}primary-wallet-card-transfer-outbox-concurrency.integration.sql`,
          ],
          { cwd: repository }
        )
      )
    );
    const outcomes = attempts
      .flatMap((result) => result.stdout.split('\n'))
      .filter((line) => ['claimed', 'existing'].includes(line));
    assert.deepEqual(outcomes.sort(), ['claimed', 'existing']);
    await execute(
      'psql',
      [
        ...parameters,
        '-f',
        `${fixtures}primary-wallet-card-transfer-outbox-recovery.integration.sql`,
      ],
      { cwd: repository }
    );
  } finally {
    execFileSync('pg_ctl', ['-D', database, '-m', 'fast', '-w', 'stop'], {
      stdio: 'pipe',
    });
  }
});
