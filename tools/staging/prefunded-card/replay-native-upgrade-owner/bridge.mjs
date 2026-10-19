import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const overlays = new Map([
  [
    'apps/web/src/lib/piggyvest/prefunded-card-provider-evidence-normalize.ts',
    '132932e58d61787d1f0d102a7590eadd0a180bb61d8af2f79fdb59995487b9fb',
  ],
  [
    'apps/web/src/lib/piggyvest/prefunded-card-provider-evidence.ts',
    'f680f58be77336110e8a2a6b40562204da88db3c7e7d06efa9229d4d9265708e',
  ],
  [
    'apps/web/src/lib/piggyvest/prefunded-card-replay-enrollment.ts',
    'ecc4bcdd78d5f54bb393e367e014c9a54ab87d539be398ea868e4357fe4f255e',
  ],
  [
    'apps/web/src/schemas/prefunded-card-replay-enrollment.ts',
    '361a594babd582a85aa4ae817fbfc1cd160869e6efec7331541f0b22a91ab78a',
  ],
  [
    'apps/web/src/lib/piggyvest/prefunded-card-signed-outflow.ts',
    'e82f3218586ba4230351a111a2e5f90c7992fc5195b7e47969c37d64e327e8c6',
  ],
  [
    'apps/web/src/schemas/prefunded-card-signed-outflow.ts',
    '21c3d37a565323ddc496085bfff1a8724ae5afe263be55620bb83b3f28c23abb',
  ],
]);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reviewedManifest =
  'b0ac46778810cf5769dbd6c56c52df30ca845dc6a90e4245f1949b5826fc5e11';
const reviewedBundle =
  'b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4';

function verifyExactOverlayInventory(inventory) {
  if (
    !Array.isArray(inventory?.files) ||
    inventory.files.length !== overlays.size ||
    new Set(inventory.files.map((row) => row.target)).size !== overlays.size ||
    inventory.files.some(
      (row) => overlays.get(row.target) !== row.replacementSha256
    ) ||
    inventory.files.some(
      (row) =>
        row.target.endsWith('prefunded-card-signed-outflow.ts') &&
        row.canonicalSha256 !== null
    )
  )
    throw new Error('Frozen six-overlay inventory refused');
}

export async function verifyRootArtifact(input) {
  if (input.reviewedManifestSha256 !== reviewedManifest)
    throw new Error('Explicit reviewed manifest refused');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.resolve(here, '../kit');
  const kit = (await lstat(packaged).catch(() => null))?.isDirectory()
    ? packaged
    : path.resolve(here, '../replay-native-upgrade');
  const { verifyArtifact } = await import(
    pathToFileURL(path.join(kit, 'artifact.mjs')).href
  );
  const { reviewOverlay } = await import(
    pathToFileURL(path.join(kit, 'contract.mjs')).href
  );
  const { authority } = await import(
    pathToFileURL(path.join(kit, 'constants.mjs')).href
  );
  const verified = verifyArtifact(input);
  const reviewed = reviewOverlay(
    input.inventoryBytes,
    authority.frozenInventorySha256
  );
  verifyExactOverlayInventory(reviewed);
  if (verified.bundleSha256 !== reviewedBundle)
    throw new Error('Explicit reviewed bundle refused');
  return verified;
}

async function read(filename, modes = [0o600]) {
  const info = await lstat(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    info.nlink !== 1 ||
    !modes.includes(info.mode & 0o777) ||
    info.size <= 0 ||
    info.size > 16_000_000
  )
    throw new Error('Root artifact file refused');
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      info.dev !== opened.dev ||
      info.ino !== opened.ino ||
      info.size !== opened.size ||
      info.mtimeMs !== opened.mtimeMs ||
      info.ctimeMs !== opened.ctimeMs ||
      info.nlink !== opened.nlink ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      opened.nlink !== after.nlink
    )
      throw new Error('Root artifact file changed');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function stage(
  artifactDirectory,
  reviewedManifestSha256,
  predecessorDirectory,
  generation
) {
  if (reviewedManifestSha256 !== reviewedManifest)
    throw new Error('Explicit reviewed manifest refused');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.resolve(here, '../kit');
  const kit = (await lstat(packaged).catch(() => null))?.isDirectory()
    ? packaged
    : path.resolve(here, '../replay-native-upgrade');
  const { prepareUpgrade } = await import(
    pathToFileURL(path.join(kit, 'upgrade.mjs')).href
  );
  const { authority } = await import(
    pathToFileURL(path.join(kit, 'constants.mjs')).href
  );
  const names = [
    'manifest.json',
    'metafile.json',
    'inventory.json',
    'virtual-entry.ts',
    'prefunded-replay-bundle.mjs',
    'captures',
  ];
  if (
    (await readdir(artifactDirectory)).sort().join('|') !==
    names.sort().join('|')
  )
    throw new Error('Artifact directory set refused');
  const captureNames = await readdir(path.join(artifactDirectory, 'captures'));
  if (
    captureNames.length === 0 ||
    captureNames.length > 4096 ||
    captureNames.some((name) => !/^[a-f0-9]{64}\.source$/.test(name))
  )
    throw new Error('Capture inventory refused');
  const captures = new Map();
  for (const name of captureNames)
    captures.set(
      name.slice(0, 64),
      await read(path.join(artifactDirectory, 'captures', name))
    );
  const manifestBytes = await read(
    path.join(artifactDirectory, 'manifest.json')
  );
  const bundleBytes = await read(
    path.join(artifactDirectory, 'prefunded-replay-bundle.mjs')
  );
  const artifactInput = {
    manifestBytes,
    bundleBytes,
    reviewedManifestSha256,
    captures,
    metafileBytes: await read(path.join(artifactDirectory, 'metafile.json')),
    inventoryBytes: await read(path.join(artifactDirectory, 'inventory.json')),
    virtualEntryBytes: await read(
      path.join(artifactDirectory, 'virtual-entry.ts')
    ),
  };
  const artifact = await verifyRootArtifact(artifactInput);
  if (
    artifact.bundleSha256 !== reviewedBundle ||
    digest(bundleBytes) !== reviewedBundle
  )
    throw new Error('Explicit reviewed bundle refused');
  const predecessorBytes = {
    bundle: await read(
      path.join(predecessorDirectory, 'code/prefunded-replay-bundle.mjs'),
      [0o644]
    ),
    daemon: await read(
      path.join(predecessorDirectory, 'code/replay-daemon.mjs'),
      [0o644]
    ),
    config: await read(
      path.join(predecessorDirectory, 'config/config.json'),
      [0o440]
    ),
    private: await read(
      path.join(predecessorDirectory, 'config/prefunded.json'),
      [0o440]
    ),
  };
  for (const [name, bytes] of Object.entries(predecessorBytes))
    if (digest(bytes) !== authority.predecessors[name])
      throw new Error('Actual predecessor bytes refused');
  const upgraded = prepareUpgrade({
    predecessorBytes,
    artifact: artifactInput,
  });
  const prepared = {
    'config.json': upgraded.files['config.json'],
    'prefunded.json': upgraded.files['prefunded.json'],
  };
  const files = new Map([
    ['code/replay-daemon.mjs', predecessorBytes.daemon],
    ['code/prefunded-replay-bundle.mjs', bundleBytes],
    ...Object.entries(prepared).map(([name, bytes]) => [
      `config/${name}`,
      bytes,
    ]),
  ]);
  for (const [name, bytes] of files)
    await writeFile(path.join(generation, name), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
  return {
    artifactManifestSha256: digest(manifestBytes),
    bundleSha256: digest(bundleBytes),
    files: Object.fromEntries(
      [...files].map(([name, bytes]) => [name, digest(bytes)])
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.getuid() !== 0 || process.argv.length !== 6)
      throw new Error('Root preparation arguments refused');
    process.stdout.write(
      `${JSON.stringify(await stage(...process.argv.slice(2)))}\n`
    );
  } catch {
    process.stderr.write(
      'Root artifact or configuration preparation refused.\n'
    );
    process.exitCode = 1;
  }
}
