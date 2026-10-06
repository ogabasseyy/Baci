import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function applyRuntimeJourneyFixture(options: {
  socketDirectory: unknown;
  sequence: 701 | 702 | 703;
  action: 'credit' | 'expire';
}): void {
  if (
    typeof options.socketDirectory !== 'string' ||
    !/^\/tmp\/baci-piggyvest-runtime\.[A-Za-z0-9]+\/socket$/.test(
      options.socketDirectory
    ) ||
    ![701, 702, 703].includes(options.sequence) ||
    !['credit', 'expire'].includes(options.action)
  )
    throw new Error('Owned synthetic fixture required');
  execFileSync(
    '/opt/homebrew/opt/postgresql@18/bin/psql',
    [
      '-X',
      '-w',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      options.socketDirectory,
      '-p',
      '55449',
      '-U',
      'harness_admin',
      '-d',
      'piggyvest_local',
      '-v',
      `sequence=${options.sequence}`,
      '-f',
      resolve(
        process.cwd(),
        `../../tools/test/runtime-journey-local-${options.action}.sql`
      ),
    ],
    { env: { NODE_ENV: 'test' }, stdio: 'pipe', timeout: 75000 }
  );
}
