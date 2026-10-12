import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authority } from './constants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const snapshotRoot =
  '/private/tmp/baci-provider-pending-upgrade-final-20261002-8d2f93d6-e97e-4309-a9d8-6a883b303bc4/public-source';
const snapshotPin =
  'a007f9484ed75d2be2802a755b2689a41d04ab89f8c900e2327ffb4776ad1a68';

export async function prepareNextKit(destination) {
  const target = path.resolve(destination);
  if (path.dirname(target) !== '/private/tmp')
    throw new Error('Unique private temporary output required');
  const raw = await readFile(path.join(snapshotRoot, 'source-manifest.json'));
  if (digest(raw) !== snapshotPin)
    throw new Error('Frozen public snapshot differs');
  const manifest = JSON.parse(raw);
  const provider = await readFile(path.join(snapshotRoot, authority.provider));
  if (digest(provider) !== authority.providerSha256)
    throw new Error('Provider pin differs');
  const files = {
    ...manifest.sources,
    ...manifest.rewrites,
    ...manifest.generated,
  };
  const captured = new Map();
  for (const [name, expected] of Object.entries(files)) {
    if (name.split('/').includes('..') || path.isAbsolute(name))
      throw new Error('Source path refused');
    const filename = path.join(snapshotRoot, name);
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Unsafe frozen source');
    const bytes = await readFile(filename);
    if (digest(bytes) !== expected)
      throw new Error(`Frozen source drift: ${name}`);
    captured.set(`candidate-snapshot/${name}`, bytes);
  }
  captured.set('candidate-snapshot/source-manifest.json', raw);
  captured.set('provider.ts', provider);
  for (const name of ['source_delta.py', 'seal_release.py', 'NEXT-RELEASE.md'])
    captured.set(name, await readFile(path.join(here, name)));
  for (const name of [
    'public-artifact.py',
    'public_artifact.py',
    'public_projection.py',
    'treasury_owner_contract.py',
  ])
    captured.set(
      `tooling/${name}`,
      await readFile(path.join(here, '..', name))
    );
  await mkdir(target, { mode: 0o700 });
  for (const [name, bytes] of captured) {
    const filename = path.join(target, name);
    await mkdir(path.dirname(filename), { mode: 0o700, recursive: true });
    await writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
  }
  await mkdir(path.join(target, 'candidate-snapshot/apps/web/public'), {
    recursive: true,
  });
  const report = {
    version: 1,
    status: 'isolated-next-source-kit-prepared-build-required',
    deadline: authority.deadline,
    originalAuthority: authority,
    frozenCandidateSourceManifestSha256: snapshotPin,
    predecessorSourceMustBeFetchedByParent: true,
    candidateSnapshotHasNotPassedInstalledPredecessorDeltaCheck: true,
    sourceDeltaMethod:
      'verify sealed installed source then replace exactly one provider line',
    files: Object.fromEntries(
      [...captured].map(([name, bytes]) => [name, digest(bytes)]).sort()
    ),
    buildExecuted: false,
    installableNextArchiveProduced: false,
    remoteActions: false,
    providerCalls: false,
    paymentStarted: false,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(target, 'next-kit.json'), reportBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  return { destination: target, nextKitSha256: digest(reportBytes), ...report };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error('Usage: node next-kit.mjs /private/tmp/unique-directory');
  const report = await prepareNextKit(process.argv[2]);
  process.stdout.write(
    `${JSON.stringify({ destination: report.destination, nextKitSha256: report.nextKitSha256, status: report.status, files: Object.keys(report.files).length })}\n`
  );
}
