import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry =
  'tools/staging/primary-wallet-card-custody/primary-wallet-card-custody-entry.ts';
const frozen = {
  'supabase/migrations/20261007200900_primary_card_signed_inbox.sql':
    'f024431b7bcaae85e77e058031f8d83676afeb796b70401310368d5fc202c90b',
  'supabase/migrations/20261007201000_primary_card_signed_inbox_worker.sql':
    'bfa7e7af160fab3a6ef8b52f6045e18296bc1457d9593d79b001b92ef4e72d7b',
};
const sourceRoots = [
  'apps/web/src/lib/piggyvest/',
  'apps/web/src/schemas/',
  'tools/staging/primary-wallet-card-custody/',
];
const service = `[Unit]
Description=Baci primary-card signed custody receipt worker (%i)
After=network-online.target
[Service]
Type=oneshot
User=baci-primary-card-custody
Group=baci-primary-card-custody
EnvironmentFile=/etc/baci/primary-card-custody-%i.env
ExecStartPre=/usr/bin/node /opt/baci/primary-card-custody/custody.cjs --readiness
ExecStart=/usr/bin/node /opt/baci/primary-card-custody/custody.cjs --once
TimeoutStartSec=55
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
StandardOutput=journal
StandardError=journal
`;
const timer = `[Unit]
Description=Baci signed custody receipt polling (%i)
[Timer]
OnBootSec=30s
OnUnitInactiveSec=30s
AccuracySec=1s
Persistent=false
Unit=baci-primary-card-custody@%i.service
[Install]
WantedBy=timers.target
`;

export async function buildPrimaryCardCustodyPackage(outputDirectory) {
  const generatorHash = sha256(await readFile(fileURLToPath(import.meta.url)));
  const destination = path.resolve(outputDirectory);
  if (
    !outputDirectory ||
    destination === repository ||
    destination.startsWith(repository + path.sep)
  )
    throw new Error('New output directory must be outside repository');
  for (const [filename, hash] of Object.entries(frozen)) {
    if (sha256(await readFile(path.join(repository, filename))) !== hash)
      throw new Error('Frozen migration bytes changed');
  }
  await mkdir(destination, { mode: 0o700 });
  const snapshots = new Map();
  const result = await build({
    absWorkingDir: repository,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(destination, 'custody.cjs'),
    external: ['pg-native'],
    metafile: true,
    tsconfig: path.join(repository, 'apps/web/tsconfig.json'),
    plugins: [
      {
        name: 'capture-reviewed-source',
        setup(plugin) {
          plugin.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'empty-server-only',
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: 'empty-server-only' },
            () => ({ contents: '' })
          );
          plugin.onLoad(
            { filter: /\.(ts|js|mjs|cjs|json)$/, namespace: 'file' },
            async (args) => {
              const bytes = await readFile(args.path);
              snapshots.set(args.path, sha256(bytes));
              return {
                contents: bytes.toString(),
                loader: args.path.endsWith('.ts')
                  ? 'ts'
                  : args.path.endsWith('.json')
                    ? 'json'
                    : 'js',
                resolveDir: path.dirname(args.path),
              };
            }
          );
        },
      },
    ],
  });
  const closure = {};
  for (const [filename, metadata] of Object.entries(result.metafile.inputs)) {
    if (metadata.bytes === 0) continue;
    const absolute = path.resolve(repository, filename);
    if (
      !filename.includes('node_modules/') &&
      !sourceRoots.some((root) => filename.startsWith(root))
    )
      throw new Error('Worker import outside reviewed closure');
    if (
      filename.includes('node_modules/') &&
      !/\/(?:pg(?:-[^/]+)?|zod|postgres-[^/]+|pgpass|split2|xtend)\//.test(
        `/${filename}`
      )
    )
      throw new Error(`Dependency outside worker closure: ${filename}`);
    if (
      !snapshots.has(absolute) ||
      sha256(await readFile(absolute)) !== snapshots.get(absolute)
    )
      throw new Error('Source changed during build');
    closure[filename] = snapshots.get(absolute);
    for (const imported of metadata.imports) {
      if (
        imported.external &&
        imported.path !== 'pg-native' &&
        !imported.path.startsWith('node:') &&
        !builtinModules.includes(imported.path)
      )
        throw new Error('Unexpected external import');
    }
  }
  const files = {
    'baci-primary-card-custody@.service': service,
    'baci-primary-card-custody@.timer': timer,
    'README.md': await readFile(path.join(directory, 'README.md'), 'utf8'),
  };
  for (const [filename, contents] of Object.entries(files))
    await writeFile(path.join(destination, filename), contents, {
      mode: 0o600,
      flag: 'wx',
    });
  const outputs = {};
  for (const filename of ['custody.cjs', ...Object.keys(files)])
    outputs[filename] = sha256(
      await readFile(path.join(destination, filename))
    );
  const migration =
    'supabase/migrations/20261007201100_primary_card_intake_role.sql';
  if (sha256(await readFile(fileURLToPath(import.meta.url))) !== generatorHash)
    throw new Error('Package generator changed during build');
  for (const [filename, hash] of Object.entries(frozen))
    if (sha256(await readFile(path.join(repository, filename))) !== hash)
      throw new Error('Frozen migrations changed during build');
  const manifest = {
    version: 1,
    status: 'review-package-only',
    activated: false,
    providerWrites: false,
    autonomousFundingReady: false,
    crosswalkSelection: 'operation_records_only',
    missingProviderContract: 'exhaustive_bank_and_internal_transaction_aliases',
    generatorSha256: generatorHash,
    entry,
    scheduler: 'systemd-oneshot-template',
    environments: ['staging', 'production'],
    deadline: 'trusted-runtime-and-database-only',
    sourceClosureSha256: Object.fromEntries(Object.entries(closure).sort()),
    outputSha256: outputs,
    migrationSha256: {
      ...frozen,
      [migration]: sha256(await readFile(path.join(repository, migration))),
    },
    bindingsRequired: [
      'separate-intake-login',
      'custody-worker-login',
      'owner-enabled-capability',
      'approved-authenticated-crosswalk-file-and-issuer-key',
      'current-expiry',
      'parent-signed-webhook',
    ],
  };
  await writeFile(
    path.join(destination, 'artifact.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' }
  );
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error(
      'Usage: node primary-wallet-card-custody-package.mjs <new-output-directory>'
    );
  console.log(
    JSON.stringify(
      await buildPrimaryCardCustodyPackage(process.argv[2]),
      null,
      2
    )
  );
}
