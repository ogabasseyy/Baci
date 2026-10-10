import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const frozen = {
  '20261007230000_primary_bank_signed_inbox.sql':
    'd5fafe3c4442b8acca9941023cc2733444ada4a60f9592f1c907a2d4a51dc240',
  '20261007230100_primary_bank_custody_prerequisite.sql':
    'bf67419b6357ec7a9b4a065cc4fd5350bae806aa2c0912d893a53d7afcc4d723',
  '20261007230200_primary_bank_inbox_worker.sql':
    'cb874b5f105d2ca35c0015af8478594412e92d85a944bab58be62bbab707915c',
  '20261008093600_primary_bank_inbox_expiry_drain.sql':
    '5b43d7d9e0d84cea0f9eb2028d50804d4c5d3efc33b64797c7c6622e997b5159',
  '20261008093700_primary_bank_inbox_unsettled_deletion_block.sql':
    '5c25b9fc187ea4239fc2120697b827baa18c63cf36fae7477ec7594d7e90973d',
};
const service = `[Unit]
Description=Baci primary bank signed receipt durable inbox worker
After=network-online.target
[Service]
Type=oneshot
User=baci-primary-bank-inbox
Group=baci-primary-bank-inbox
EnvironmentFile=/etc/baci/primary-bank-inbox.env
ExecStartPre=/usr/bin/node /opt/baci/primary-bank-inbox/bank-inbox.cjs --readiness
ExecStart=/usr/bin/node /opt/baci/primary-bank-inbox/bank-inbox.cjs --once
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
Description=Poll durable primary bank signed receipts
[Timer]
OnBootSec=30s
OnUnitInactiveSec=30s
AccuracySec=1s
Persistent=false
Unit=baci-primary-bank-inbox.service
[Install]
WantedBy=timers.target
`;

export async function buildPrimaryBankInboxPackage(outputDirectory) {
  const destination = path.resolve(outputDirectory || '.');
  if (
    !outputDirectory ||
    destination === repository ||
    destination.startsWith(repository + path.sep)
  )
    throw new Error('New package directory must be outside repository');
  for (const [filename, expected] of Object.entries(frozen)) {
    if (
      sha256(
        await readFile(path.join(repository, 'supabase/migrations', filename))
      ) !== expected
    )
      throw new Error('Frozen bank inbox migration changed');
  }
  await mkdir(destination, { mode: 0o700 });
  const sources = new Map();
  const result = await build({
    absWorkingDir: repository,
    entryPoints: [
      'tools/staging/primary-wallet-bank-inbox/primary-wallet-bank-inbox-entry.ts',
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(destination, 'bank-inbox.cjs'),
    external: ['pg-native'],
    metafile: true,
    define: { 'import.meta.url': 'undefined' },
    tsconfig: path.join(repository, 'apps/web/tsconfig.json'),
    plugins: [
      {
        name: 'reviewed-server-source',
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
              sources.set(args.path, sha256(bytes));
              return {
                contents: bytes.toString(),
                loader: args.path.endsWith('.ts')
                  ? 'ts'
                  : args.path.endsWith('.json')
                    ? 'json'
                    : 'js',
              };
            }
          );
        },
      },
    ],
  });
  for (const [filename, digest] of sources) {
    if (sha256(await readFile(filename)) !== digest)
      throw new Error('Package source changed during build');
  }
  for (const [filename, expected] of Object.entries(frozen)) {
    const bytes = await readFile(
      path.join(repository, 'supabase/migrations', filename)
    );
    if (sha256(bytes) !== expected)
      throw new Error('Frozen bank inbox migration changed during build');
    await writeFile(path.join(destination, filename), bytes, { mode: 0o600 });
  }
  await writeFile(
    path.join(destination, 'baci-primary-bank-inbox.service'),
    service,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(destination, 'baci-primary-bank-inbox.timer'),
    timer,
    { mode: 0o600 }
  );
  const artifacts = {};
  for (const filename of [
    'bank-inbox.cjs',
    'baci-primary-bank-inbox.service',
    'baci-primary-bank-inbox.timer',
  ])
    artifacts[filename] = sha256(
      await readFile(path.join(destination, filename))
    );
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        purpose: 'Offline package only; not installed, scheduled or deployed',
        generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        migrations: frozen,
        artifacts,
        sources: Object.fromEntries(
          [...sources].map(([filename, digest]) => [
            path.relative(repository, filename),
            digest,
          ])
        ),
        bundledInputs: Object.keys(result.metafile.inputs),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  return destination;
}
