import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version } from 'esbuild';
import { authority } from './constants.mjs';
import { reviewOverlay } from './contract.mjs';
import { publishPrivateArtifact } from './output.mjs';
import { createSourceCapture } from './source-capture.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const directory = path.dirname(fileURLToPath(import.meta.url));
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export async function buildReplayNativeUpgrade({ inventoryBytes, reviewedInventorySha256, outputDirectory }) {
  const inventory = reviewOverlay(inventoryBytes, reviewedInventorySha256);
  if (reviewedInventorySha256 !== authority.frozenInventorySha256) throw new Error('Frozen inventory authority pin differs');
  if (Math.floor(Date.now() / 1000) >= authority.deadlineEpoch) throw new Error('Fixed deadline expired');
  if (await realpath(inventory.receiverRoot) !== inventory.receiverRoot
      || !(await lstat(inventory.receiverRoot)).isDirectory()) throw new Error('Receiver root alias refused');
  const overlays = [];
  for (const row of inventory.files) {
    const filename = path.join(inventory.receiverRoot, row.source);
    if (await realpath(filename) !== filename || !(await lstat(filename)).isFile())
      throw new Error('Receiver source alias refused');
    overlays.push({ ...row, filename });
  }
  if (await realpath(authority.repository) !== authority.repository) throw new Error('Canonical root alias refused');
  const capture = await createSourceCapture({ repository: authority.repository, overlays });
  for (const row of [...inventory.inventory.reviewFiles, ...inventory.inventory.unchangedImportedHarness]) {
    if (await realpath(row.path) !== row.path || await capture.trackControl(row.path) !== row.sha256)
      throw new Error('Frozen receiver review or harness bytes differ');
  }
  const controls = ['pnpm-lock.yaml', 'package.json', 'apps/web/package.json',
    'apps/web/tsconfig.json', authority.workerPolicy];
  for (const filename of controls) await capture.trackControl(path.join(authority.repository, filename));
  if (await capture.trackControl(path.join(authority.repository, authority.workerPolicy)) !== authority.workerPolicySha256)
    throw new Error('Worker dependency policy predecessor differs');
  for (const filename of ['build.mjs', 'constants.mjs', 'contract.mjs', 'configuration.mjs',
    'source-capture.mjs', 'output.mjs', 'upgrade.mjs', 'artifact.mjs'])
    await capture.trackControl(path.join(directory, filename));
  const require = createRequire(import.meta.url);
  const toolPaths = [require.resolve('esbuild'), require.resolve('esbuild/package.json'),
    require.resolve('@esbuild/' + process.platform + '-' + process.arch + '/bin/esbuild')];
  for (const filename of toolPaths) await capture.trackControl(filename);
  if (process.env.ESBUILD_BINARY_PATH) throw new Error('Unreviewed compiler binary override refused');
  const tsconfig = JSON.parse(await readFile(path.join(authority.repository, 'apps/web/tsconfig.json'), 'utf8'));
  if ('extends' in tsconfig) throw new Error('Uncaptured tsconfig inheritance refused');
  const virtualEntry = `export { ${authority.exportName} } from './${authority.entry}';`;
  const result = await build({
    absWorkingDir: authority.repository,
    stdin: { contents: virtualEntry, resolveDir: authority.repository, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    outfile: path.join(authority.repository, 'prefunded-replay-bundle.mjs'),
    banner: { js: authority.banner }, external: ['pg-native'], write: false, metafile: true,
    tsconfig: path.join(authority.repository, 'apps/web/tsconfig.json'),
    plugins: [capture.plugin], logLevel: 'silent',
  });
  const outputs = Object.values(result.metafile.outputs);
  if (result.outputFiles.length !== 1 || outputs.length !== 1
      || outputs[0].exports.join('|') !== authority.exportName
      || !result.outputFiles[0].text.startsWith(authority.banner))
    throw new Error('Compiled factory export ABI or ESM banner differs');
  const sealed = await capture.seal(result.metafile);
  const bytes = Buffer.from(result.outputFiles[0].contents);
  const manifest = {
    schemaVersion: 1, status: 'compiled-artifact-only', deadline: authority.deadline,
    repository: authority.repository, entry: authority.entry, exports: [authority.exportName],
    build: { platform: 'node', format: 'esm', target: 'node22', external: ['pg-native'],
      bannerSha256: digest(authority.banner), virtualEntrySha256: digest(virtualEntry),
      esbuildVersion: version, hostNodeVersion: process.version },
    reviewedInventorySha256, inventory: inventory.inventory, predecessors: authority.predecessors,
    parentBaseline: authority.parentBaseline, scope: authority.scope,
    output: { filename: 'prefunded-replay-bundle.mjs', sha256: digest(bytes) },
    sources: sealed.sources, observed: sealed.observed, metafileSha256: digest(json(result.metafile)),
    installed: false, providerCalled: false, sqlExecuted: false,
  };
  const files = new Map([['prefunded-replay-bundle.mjs', bytes], ['manifest.json', json(manifest)],
    ['metafile.json', json(result.metafile)], ['inventory.json', inventoryBytes],
    ['virtual-entry.ts', Buffer.from(virtualEntry)]]);
  for (const [sha256, contents] of sealed.captures) files.set('captures/' + sha256 + '.source', contents);
  if (Math.floor(Date.now() / 1000) >= authority.deadlineEpoch) throw new Error('Fixed deadline expired during build');
  const destination = await publishPrivateArtifact({ repository: authority.repository,
    receiver: inventory.receiverRoot, destination: outputDirectory, files });
  return { outputDirectory: destination, bundleSha256: manifest.output.sha256,
    manifestSha256: digest(files.get('manifest.json')), sourceCount: Object.keys(sealed.sources).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: build.mjs FINAL_INVENTORY REVIEWED_SHA256 NEW_PRIVATE_OUTPUT');
    const result = await buildReplayNativeUpgrade({ inventoryBytes: await readFile(process.argv[2]),
      reviewedInventorySha256: process.argv[3], outputDirectory: process.argv[4] });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stderr.write('Replay build refused; inspect reviewed local inputs. No artifact installed.\n');
    process.exitCode = 1;
  }
}
