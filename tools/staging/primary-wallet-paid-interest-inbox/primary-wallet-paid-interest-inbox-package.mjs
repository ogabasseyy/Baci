import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const frozen = {
  '20261007220000_piggyvest_primary_interest_storage.sql':
    '7a1c7765a5d5dd971fc369df4202ecf9e9bcc908216b3d9c24fff19831a38992',
  '20261007220001_piggyvest_primary_interest_evidence.sql':
    '4440296cabca96c99fe0091c0e71e5ae0b9adb8783bb7209da1dc312cbce2a13',
  '20261007220002_piggyvest_primary_interest_projection.sql':
    '69d04201df8f6acc9d1d931ba61bae1c8a8d30e796f382f1c287c86ddd1ca7e5',
  '20261007220003_piggyvest_primary_interest_reads_notifications.sql':
    'b9a68040c6c2df26abda6b80b054d556bd000a3007c473e1b8964d7c2444f888',
  '20261007220100_piggyvest_primary_interest_inbox.sql':
    'c42c1a478d4038d7c41fd35520dee3b4e6955f8ca38a9a1bb57ca275ad29804e',
  '20261007220101_piggyvest_primary_interest_inbox_worker.sql':
    '1207928cce8e03ad87f9fb126c2a3c83cee370a8423bb34afb3dcf721e6e1f32',
};
const service = `[Unit]
Description=Baci primary savings paid-interest durable inbox worker
After=network-online.target
[Service]
Type=oneshot
User=baci-primary-interest-inbox
Group=baci-primary-interest-inbox
EnvironmentFile=/etc/baci/primary-paid-interest.env
ExecStartPre=/usr/bin/node /opt/baci/primary-paid-interest/interest-inbox.cjs --readiness
ExecStart=/usr/bin/node /opt/baci/primary-paid-interest/interest-inbox.cjs --once
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
Description=Poll durable primary savings paid-interest receipts
[Timer]
OnBootSec=30s
OnUnitInactiveSec=30s
AccuracySec=1s
Persistent=false
Unit=baci-primary-paid-interest.service
[Install]
WantedBy=timers.target
`;

export async function buildPrimaryPaidInterestInboxPackage(outputDirectory) {
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
      throw new Error('Frozen paid-interest migration changed');
  }
  await mkdir(destination, { mode: 0o700 });
  const sources = new Map();
  const result = await build({
    absWorkingDir: repository,
    entryPoints: [
      'tools/staging/primary-wallet-paid-interest-inbox/primary-wallet-paid-interest-inbox-entry.ts',
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(destination, 'interest-inbox.cjs'),
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
      throw new Error('Frozen paid-interest migration changed during build');
    await writeFile(path.join(destination, filename), bytes, { mode: 0o600 });
  }
  await writeFile(
    path.join(destination, 'baci-primary-paid-interest.service'),
    service,
    { mode: 0o600 }
  );
  await writeFile(
    path.join(destination, 'baci-primary-paid-interest.timer'),
    timer,
    { mode: 0o600 }
  );
  const artifacts = {};
  for (const filename of [
    'interest-inbox.cjs',
    'baci-primary-paid-interest.service',
    'baci-primary-paid-interest.timer',
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
