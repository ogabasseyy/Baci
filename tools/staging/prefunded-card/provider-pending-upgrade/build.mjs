import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { snapshot } from '../public-source.mjs';
import { buildWorkerRenewal } from '../worker-renewal-build/build.mjs';
import { authority, entrypoints } from './constants.mjs';
import { staticGraph } from './graph.mjs';

const digest = (content) => createHash('sha256').update(content).digest('hex');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = authority.repository;

export async function prepare(outputDirectory) {
  const destination = path.resolve(outputDirectory);
  if (
    !destination.startsWith('/private/tmp/') ||
    path.dirname(destination) !== '/private/tmp'
  )
    throw new Error('Output must be a unique immediate child of /private/tmp');
  const provider = await readFile(path.join(root, authority.provider));
  if (digest(provider) !== authority.providerSha256)
    throw new Error('Approved provider source differs');
  const line = "          status === 'abandoned' ||\n";
  if (provider.toString().split(line).length !== 2)
    throw new Error('One-line change sentinel differs');
  const graph = await staticGraph(root, entrypoints);
  await mkdir(destination, { mode: 0o700 });
  const write = async (name, value) =>
    writeFile(
      path.join(destination, name),
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 }
    );
  const buildInputs = {};
  for (const relative of [
    'pnpm-lock.yaml',
    'package.json',
    'apps/web/package.json',
    'apps/web/tsconfig.json',
    'tools/staging/prefunded-card/public-source.mjs',
    'tools/staging/prefunded-card/public-next.config.mjs',
    'tools/staging/prefunded-card/worker-renewal-build/build.mjs',
  ])
    buildInputs[relative] = digest(await readFile(path.join(root, relative)));
  for (const name of (await readdir(here)).sort()) {
    if (!/\.(mjs|md)$/.test(name)) continue;
    const relative = `tools/staging/prefunded-card/provider-pending-upgrade/${name}`;
    buildInputs[relative] = digest(await readFile(path.join(root, relative)));
  }
  const originalTooling = {};
  for (const directory of [
    '',
    'financial-activation',
    'public-mutation-activation',
    'card-week-renewal',
  ]) {
    for (const name of (
      await readdir(path.join(here, '..', directory))
    ).sort()) {
      if (!/\.(py|sql|json|md)$/.test(name)) continue;
      const relative = ['tools/staging/prefunded-card', directory, name]
        .filter(Boolean)
        .join('/');
      originalTooling[relative] = digest(
        await readFile(path.join(root, relative))
      );
    }
  }
  const workers = await buildWorkerRenewal(path.join(destination, 'workers'));
  const publicSource = await snapshot(
    root,
    path.join(destination, 'public-source')
  );
  const publicResult = await build({
    absWorkingDir: path.join(destination, 'public-source'),
    entryPoints: [entrypoints.publicCheckout],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    write: false,
    metafile: true,
    tsconfig: path.join(destination, 'public-source/apps/web/tsconfig.json'),
  });
  await writeFile(
    path.join(destination, 'public-checkout.cjs'),
    publicResult.outputFiles[0].contents,
    { flag: 'wx', mode: 0o600 }
  );
  for (const [relative, expected] of Object.entries({
    ...graph.sources,
    ...originalTooling,
    ...workers.sourceClosureSha256,
    ...publicSource.sources,
    ...buildInputs,
  })) {
    if (digest(await readFile(path.join(root, relative))) !== expected)
      throw new Error(`Source drift before sealing: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(graph.sources)) {
    if (
      workers.sourceClosureSha256[relative] &&
      workers.sourceClosureSha256[relative] !== expected
    )
      throw new Error('Worker/static graph source mismatch');
    if (
      publicSource.sources[relative] &&
      publicSource.sources[relative] !== expected
    )
      throw new Error('Public/static graph source mismatch');
  }
  await write('full-static-graph.json', graph);
  await write('build-inputs.json', buildInputs);
  await write('public-checkout.metafile.json', publicResult.metafile);
  await write('original-authority.json', {
    ...authority,
    toolingSha256: originalTooling,
  });
  await write('source-change.json', {
    path: authority.provider,
    candidateSha256: authority.providerSha256,
    reconstructedPredecessorSha256: digest(
      provider.toString().replace(line, '')
    ),
    reconstructionIsRuntimeProof: false,
    addedLine: line.trim(),
  });
  const artifacts = {};
  for (const name of [
    'public-checkout.cjs',
    'public-checkout.metafile.json',
    'full-static-graph.json',
    'build-inputs.json',
    'original-authority.json',
    'source-change.json',
    'public-source/source-manifest.json',
    'workers/artifact.manifest.json',
    'workers/background.cjs',
    'workers/snapshot.cjs',
    'workers/readiness.cjs',
  ])
    artifacts[name] = digest(await readFile(path.join(destination, name)));
  const preparation = {
    version: 1,
    status: 'prepared-public-integration-required',
    deadline: authority.deadline,
    financialSealSha256: authority.financialSealSha256,
    providerSha256: authority.providerSha256,
    artifacts,
    sourceCount: Object.keys(graph.sources).length,
    workerSourceCount: Object.keys(workers.sourceClosureSha256).length,
    publicSourceCount: Object.keys(publicSource.sources).length,
    publicHandlerIsNextStandaloneRelease: false,
    parentGates: [
      'exact-current-predecessor-capture',
      'compare-prior-complete-source-closures',
      'integrate-public-handler-into-reviewed-Next-release',
      'seal-transaction-contract',
      'parent-review',
      'unauthenticated-denials',
      'protected-state-readback',
    ],
    changesApplied: false,
    remoteActions: false,
    providerWrites: false,
    runtimeActivated: false,
  };
  await write('preparation.json', preparation);
  return {
    destination,
    preparationSha256: digest(
      await readFile(path.join(destination, 'preparation.json'))
    ),
    ...preparation,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error('Usage: node build.mjs /private/tmp/unique-directory');
  process.stdout.write(
    `${JSON.stringify(await prepare(process.argv[2]), null, 2)}\n`
  );
}
