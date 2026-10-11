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
  'tools/staging/primary-wallet-card-checkout-abandonment/primary-wallet-card-checkout-abandonment-entry.ts';
const frozen = {
  'supabase/migrations/20261007200000_primary_wallet_card_checkout_storage.sql':
    'e8106867e055b1922dafc93dd3cad06d98b32fa782aea7423645f6831abeaaf5',
  'supabase/migrations/20261008090700_primary_card_abandoned_release.sql':
    '6c47367c30b24ad3afe9eee1fff19eed1474ec25a942078e64f6e542a9a210dc',
  'supabase/migrations/20261008092300_primary_card_expiry_drain.sql':
    '46b3d1af90c53ac65228a4f8f72dacebce4fba650263e48e6d01cee97cbb0d80',
};
const sourceRoots = [
  'apps/web/src/lib/piggyvest/',
  'apps/web/src/schemas/',
  'apps/web/src/scripts/primary-wallet-card-checkout-abandonment-cli.ts',
  'tools/staging/primary-wallet-card-checkout-abandonment/',
];
// Hourly cadence: the stale cutoff is 24h, so hourly polling reclaims
// walk-away checkouts within ~25h while keeping provider verify load
// negligible (at most 25 verifications per run).
const service = `[Unit]
Description=Baci primary-card stale checkout abandonment worker
After=network-online.target
[Service]
Type=oneshot
User=baci-primary-card-abandonment
Group=baci-primary-card-abandonment
EnvironmentFile=/etc/baci/primary-card-abandonment.env
ExecStartPre=/usr/bin/node /opt/baci/primary-card-abandonment/abandonment.cjs --readiness
ExecStart=/usr/bin/node /opt/baci/primary-card-abandonment/abandonment.cjs --once
TimeoutStartSec=120
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
Description=Baci stale checkout abandonment polling
[Timer]
OnBootSec=5min
OnUnitInactiveSec=1h
AccuracySec=1min
Persistent=false
Unit=baci-primary-card-abandonment.service
[Install]
WantedBy=timers.target
`;

export async function buildPrimaryCardAbandonmentPackage(outputDirectory) {
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
    outfile: path.join(destination, 'abandonment.cjs'),
    external: ['pg-native'],
    metafile: true,
    tsconfig: path.join(repository, 'apps/web/tsconfig.json'),
    // The bundled CLI's direct-run guard reads import.meta.url, which is
    // empty under cjs output. Pin it to the install path so the guard
    // stays inert inside the bundle (the entry invokes the CLI directly)
    // and esbuild emits no empty-import-meta warning.
    define: {
      'import.meta.url':
        '"file:///opt/baci/primary-card-abandonment/abandonment.cjs"',
    },
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
    'baci-primary-card-abandonment.service': service,
    'baci-primary-card-abandonment.timer': timer,
    README: await readFile(path.join(directory, 'README.md'), 'utf8'),
  };
  for (const [filename, contents] of Object.entries(files))
    await writeFile(path.join(destination, filename), contents, {
      mode: 0o600,
      flag: 'wx',
    });
  const outputs = {};
  for (const filename of ['abandonment.cjs', ...Object.keys(files)])
    outputs[filename] = sha256(
      await readFile(path.join(destination, filename))
    );
  const migration =
    'supabase/migrations/20261008093900_primary_card_stale_ready_selector.sql';
  if (sha256(await readFile(fileURLToPath(import.meta.url))) !== generatorHash)
    throw new Error('Package generator changed during build');
  for (const [filename, hash] of Object.entries(frozen))
    if (sha256(await readFile(path.join(repository, filename))) !== hash)
      throw new Error('Frozen migrations changed during build');
  const manifest = {
    version: 1,
    status: 'review-package-only',
    activated: false,
    providerWritesPerformed: false,
    financialTransportIncluded: false,
    autonomousFundingReady: false,
    selection: 'bounded_stale_ready_checkout_selector',
    generatorSha256: generatorHash,
    entry,
    scheduler: 'systemd-oneshot-template',
    environments: ['staging', 'production'],
    cadence: 'hourly',
    sourceClosureSha256: Object.fromEntries(Object.entries(closure).sort()),
    outputSha256: outputs,
    migrationSha256: {
      ...frozen,
      [migration]: sha256(await readFile(path.join(repository, migration))),
    },
    bindingsRequired: [
      'evidence-login',
      'owner-abandonment-approval',
      'exact-checkout-authority',
      'paystack-verify-only',
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
      'Usage: node primary-wallet-card-checkout-abandonment-package.mjs <new-output-directory>'
    );
  console.log(
    JSON.stringify(
      await buildPrimaryCardAbandonmentPackage(process.argv[2]),
      null,
      2
    )
  );
}
