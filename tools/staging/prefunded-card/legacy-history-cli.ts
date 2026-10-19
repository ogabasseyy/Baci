import 'server-only';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLegacyProofPublicationTime,
  readPrefundedLegacyHistory,
} from './legacy-history-read';

const SOURCE = '/home/bassey/pvb-staging-receipts/intake-config.json';

function privateConfig(expectedOwner: number): unknown {
  const directory = lstatSync(dirname(SOURCE));
  if (
    directory.isSymbolicLink() ||
    !directory.isDirectory() ||
    directory.uid !== expectedOwner ||
    (directory.mode & 0o077) !== 0
  )
    throw new Error();
  const descriptor = openSync(
    SOURCE,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.uid !== expectedOwner ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > 16384
    )
      throw new Error();
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const ownerRead = process.argv[2] === '--owner-read-only';
  if (
    process.argv.length !== 3 ||
    (!ownerRead && process.argv[2] !== '--read-only') ||
    (ownerRead && process.getuid?.() !== 0)
  )
    throw new Error();
  const expectedOwner = ownerRead
    ? Number(
        execFileSync('/usr/bin/id', ['-u', 'bassey'], {
          encoding: 'utf8',
          timeout: 5000,
          env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' },
        }).trim()
      )
    : process.getuid?.();
  if (
    typeof expectedOwner !== 'number' ||
    !Number.isSafeInteger(expectedOwner) ||
    expectedOwner <= 0
  )
    throw new Error();
  const directory = dirname(fileURLToPath(import.meta.url));
  const metadata = lstatSync(directory);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error();
  const proof = await readPrefundedLegacyHistory({
    readConfig: () => privateConfig(expectedOwner),
    fetchImplementation: fetch,
    query: (container, login, sql) => {
      const output = execFileSync(
        '/usr/bin/docker',
        [
          'exec',
          '-i',
          container,
          container === 'pvb-staging-receipts-db'
            ? '/usr/local/bin/psql'
            : '/nix/var/nix/profiles/default/bin/psql',
          '-XqAt',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          login,
          '-d',
          'postgres',
        ],
        {
          input: sql,
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 12 * 1024 * 1024,
          env: {
            HOME: '/home/bassey',
            PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
            LANG: 'C',
            LC_ALL: 'C',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      return Promise.resolve(JSON.parse(output));
    },
  });
  const outputPath = join(directory, 'legacy-proof.json');
  assertLegacyProofPublicationTime(proof.ownerSealed.verifiedAt, Date.now());
  writeFileSync(outputPath, JSON.stringify(proof), { mode: 0o600, flag: 'wx' });
  assertLegacyProofPublicationTime(proof.ownerSealed.verifiedAt, Date.now());
  console.log(
    JSON.stringify({
      status: 'history-verified',
      goalId: proof.goalId,
      principalKobo: proof.principalKobo,
      receipts: proof.proofs.length,
      provenance: 'provider_reconciliation',
      outputPath,
      changesMade: false,
    })
  );
}

void main().catch((error: unknown) => {
  const matched =
    error instanceof Error
      ? /^Legacy history verification refused \(([a-z-]+)\)$/.exec(
          error.message
        )
      : null;
  console.log(
    JSON.stringify({
      status: 'history-verification-refused',
      stage: matched?.[1] ?? 'local-preflight',
      changesMade: false,
    })
  );
  process.exitCode = 1;
});
