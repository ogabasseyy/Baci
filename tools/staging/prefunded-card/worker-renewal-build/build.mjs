import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const outputs = [
  ['background', 'apps/web/src/scripts/run-prefunded-card-background.ts'],
  ['snapshot', 'tools/staging/prefunded-card/treasury-snapshot-cli.ts'],
  ['readiness', 'tools/staging/prefunded-card/runtime-readiness-cli.ts'],
];
const deadlineAuthorityPath =
  'tools/staging/prefunded-card/card-week-renewal/sealed-source.json';
const deadlineSchemaPath =
  'apps/web/src/schemas/prefunded-card-known-deadline.ts';
const priorDeadline = '2026-09-29T15:59:10Z';
const deadline = '2026-10-06T15:59:10Z';
const sourceRoots = [
  'apps/web/src/scripts/',
  'apps/web/src/lib/',
  'apps/web/src/schemas/',
  'packages/shared/src/',
  'tools/staging/prefunded-card/',
];
const bundledPackageAllowlist = new Set([
  'pg',
  'pg-cloudflare',
  'pg-connection-string',
  'pg-int8',
  'pg-pool',
  'pg-protocol',
  'pg-types',
  'pgpass',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
  'packet-reader',
  'obuf',
  'split2',
  'xtend',
  'readable-stream',
  'string_decoder',
  'util-deprecate',
  'process-nextick-args',
  'isarray',
  'core-util-is',
  'inherits',
  'safe-buffer',
  'zod',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function verifySourceSnapshots(snapshots) {
  for (const [filename, expectedHash] of snapshots) {
    if (sha256(await readFile(filename)) !== expectedHash) {
      throw new Error(`Worker source changed during compilation: ${filename}`);
    }
  }
}

export async function buildWorkerRenewal(outputDirectory) {
  const destination = path.resolve(outputDirectory);
  if (
    !outputDirectory ||
    destination === repository ||
    destination.startsWith(repository + path.sep)
  ) {
    throw new Error('Output must be a new directory outside the repository');
  }
  const authorityText = await readFile(
    path.join(repository, deadlineAuthorityPath),
    'utf8'
  );
  const authority = JSON.parse(authorityText);
  const deadlineSchema = await readFile(
    path.join(repository, deadlineSchemaPath),
    'utf8'
  );
  if (
    authority.oldDeadline !== priorDeadline ||
    authority.newDeadline !== deadline ||
    !deadlineSchema.includes(`'${priorDeadline}'`) ||
    !deadlineSchema.includes(`'${deadline}'`)
  ) {
    throw new Error(
      'Renewal deadline sentinels differ from sealed source and known-deadline schema'
    );
  }
  try {
    await mkdir(destination, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error('Output must be a new directory');
    throw error;
  }
  const entries = outputs.map(([name, source]) => ({
    in: path.join(repository, source),
    out: name,
  }));
  const capturedSources = new Map();
  const result = await build({
    absWorkingDir: repository,
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outdir: destination,
    entryNames: '[name]',
    outExtension: { '.js': '.cjs' },
    external: ['pg-native'],
    metafile: true,
    tsconfig: path.join(repository, 'apps/web/tsconfig.json'),
    plugins: [
      {
        name: 'worker-source-capture',
        setup(plugin) {
          plugin.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'empty-server-only',
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: 'empty-server-only' },
            () => ({ contents: '' })
          );
          plugin.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
            const loaders = {
              '.cjs': 'js',
              '.js': 'js',
              '.json': 'json',
              '.mjs': 'js',
              '.ts': 'ts',
              '.tsx': 'tsx',
            };
            const loader = loaders[path.extname(args.path)];
            if (!loader)
              throw new Error(
                `Worker source extension outside allowlist: ${args.path}`
              );
            const contents = await readFile(args.path);
            capturedSources.set(path.resolve(args.path), sha256(contents));
            return { contents, loader, resolveDir: path.dirname(args.path) };
          });
        },
      },
    ],
  });

  await verifySourceSnapshots(capturedSources);
  const sourceHashes = {};
  for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
    if (metadata.bytes === 0) continue;
    const absolute = path.resolve(repository, input);
    const relative = path
      .relative(repository, absolute)
      .split(path.sep)
      .join('/');
    const packageMatch = relative.match(
      /(?:^|\/)node_modules\/(?:\.pnpm\/([^/]+)@[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/
    );
    const packageName =
      packageMatch?.[1]?.replace(/^[^+]+\+/, '') ?? packageMatch?.[2];
    const isDependency =
      relative.startsWith('node_modules/') ||
      relative.includes('/node_modules/');
    if (isDependency && !bundledPackageAllowlist.has(packageName)) {
      throw new Error(
        `Package outside bundled dependency allowlist: ${relative}`
      );
    }
    if (
      !isDependency &&
      !sourceRoots.some((root) => relative.startsWith(root))
    ) {
      throw new Error(`Import outside worker source allowlist: ${relative}`);
    }
    const capturedHash = capturedSources.get(absolute);
    if (!capturedHash)
      throw new Error(
        `Worker source was not captured during compilation: ${relative}`
      );
    sourceHashes[relative] = capturedHash;
    for (const imported of metadata.imports) {
      const coreModule =
        imported.path.startsWith('node:') ||
        builtinModules.includes(imported.path);
      if (imported.external && imported.path !== 'pg-native' && !coreModule) {
        throw new Error(`External import outside allowlist: ${imported.path}`);
      }
    }
  }
  const authorityAfter = await readFile(
    path.join(repository, deadlineAuthorityPath)
  );
  const deadlineSchemaAfter = await readFile(
    path.join(repository, deadlineSchemaPath)
  );
  if (
    sha256(authorityAfter) !== sha256(authorityText) ||
    sha256(deadlineSchemaAfter) !== sha256(deadlineSchema)
  ) {
    throw new Error('Renewal deadline source changed during compilation');
  }
  for (const entry of entries) {
    if (
      !sourceHashes[
        path.relative(repository, entry.in).split(path.sep).join('/')
      ]
    ) {
      throw new Error(`Worker entry missing from source closure: ${entry.in}`);
    }
  }

  const outputHashes = {};
  for (const [name] of outputs) {
    const filename = `${name}.cjs`;
    const contents = await readFile(path.join(destination, filename));
    outputHashes[filename] = sha256(contents);
  }
  const manifest = {
    schemaVersion: 1,
    status: 'compiled-artifact-only',
    deadline,
    priorDeadline,
    deadlineAuthority: {
      path: deadlineAuthorityPath,
      sha256: sha256(authorityText),
      knownDeadlineSchemaPath: deadlineSchemaPath,
      knownDeadlineSchemaSha256: sha256(deadlineSchema),
    },
    containerPaths: {
      'background.cjs': '/opt/pvb-worker/background.cjs',
      'snapshot.cjs': '/opt/pvb-worker/snapshot.cjs',
      'readiness.cjs': '/opt/pvb-worker/readiness.cjs',
    },
    entrypoints: Object.fromEntries(
      outputs.map(([name, source]) => [`${name}.cjs`, source])
    ),
    sourceClosureSha256: Object.fromEntries(
      Object.entries(sourceHashes).sort()
    ),
    outputSha256: outputHashes,
    bundledDependencies: ['pg'],
    externalExternals: ['pg-native'],
    serverOnly: 'empty plugin',
    financialBounds: {
      companySandboxBudgetKobo: 10000,
      originalPrincipalKobo: 10000,
      principalMutation: false,
    },
    runtimeConstraints: {
      roleLoginRequired: true,
      tls: 'strict',
      rlsBypass: false,
    },
    changesApplied: false,
    providerWrites: false,
    runtimeActivated: false,
  };
  await writeFile(
    path.join(destination, 'artifact.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      flag: 'wx',
      mode: 0o600,
    }
  );
  return manifest;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory || process.argv.length !== 3)
    throw new Error('Usage: node build.mjs <new-output-directory>');
  const manifest = await buildWorkerRenewal(outputDirectory);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
