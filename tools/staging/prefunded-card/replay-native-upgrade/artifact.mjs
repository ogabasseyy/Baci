import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { authority } from './constants.mjs';
import { reviewOverlay } from './contract.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cores = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const parse = (bytes, limit) => {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limit) throw new Error();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  if (JSON.stringify(value) !== text.replace(/("(?:\\.|[^"\\])*")|\s+/g, (match, quoted) => quoted ?? '')) throw new Error();
  return value;
};

export function verifyArtifact({ manifestBytes, reviewedManifestSha256, bundleBytes,
  inventoryBytes, metafileBytes, virtualEntryBytes, captures }) {
  try {
    if (!hex(reviewedManifestSha256) || !Buffer.isBuffer(manifestBytes)
        || digest(manifestBytes) !== reviewedManifestSha256 || !Buffer.isBuffer(bundleBytes)
        || bundleBytes.length > 16_000_000 || !(captures instanceof Map)) throw new Error();
    const meta = parse(manifestBytes, 2_000_000);
    if (!shape(meta, ['schemaVersion', 'status', 'deadline', 'repository', 'entry', 'exports', 'build',
      'reviewedInventorySha256', 'inventory', 'predecessors', 'parentBaseline', 'scope', 'output', 'sources', 'observed',
      'metafileSha256', 'installed', 'providerCalled', 'sqlExecuted'])
        || meta.schemaVersion !== 1 || meta.status !== 'compiled-artifact-only'
        || meta.deadline !== authority.deadline || meta.repository !== authority.repository
        || meta.entry !== authority.entry || !isDeepStrictEqual(meta.exports, [authority.exportName])
        || !isDeepStrictEqual(meta.predecessors, authority.predecessors)
        || !isDeepStrictEqual(meta.parentBaseline, authority.parentBaseline)
        || !isDeepStrictEqual(meta.scope, authority.scope)
        || meta.installed !== false || meta.providerCalled !== false || meta.sqlExecuted !== false
        || meta.reviewedInventorySha256 !== authority.frozenInventorySha256) throw new Error();
    const reviewed = reviewOverlay(inventoryBytes, meta.reviewedInventorySha256);
    if (!isDeepStrictEqual(meta.inventory, reviewed.inventory)
        || !shape(meta.build, ['platform', 'format', 'target', 'external', 'bannerSha256',
          'virtualEntrySha256', 'esbuildVersion', 'hostNodeVersion'])
        || meta.build.platform !== 'node' || meta.build.format !== 'esm' || meta.build.target !== 'node22'
        || !isDeepStrictEqual(meta.build.external, ['pg-native'])
        || meta.build.bannerSha256 !== digest(authority.banner)
        || typeof meta.build.esbuildVersion !== 'string' || typeof meta.build.hostNodeVersion !== 'string'
        || !Buffer.isBuffer(virtualEntryBytes)
        || virtualEntryBytes.toString() !== `export { ${authority.exportName} } from './${authority.entry}';`
        || meta.build.virtualEntrySha256 !== digest(virtualEntryBytes)
        || !shape(meta.output, ['filename', 'sha256'])
        || meta.output.filename !== 'prefunded-replay-bundle.mjs' || meta.output.sha256 !== digest(bundleBytes)
        || !bundleBytes.toString().startsWith(authority.banner)
        || !meta.sources || Array.isArray(meta.sources) || !meta.sources[authority.entry]
        || !meta.observed || Array.isArray(meta.observed)) throw new Error();
    const expectedCaptures = new Set();
    for (const [filename, row] of Object.entries(meta.observed)) {
      if (!path.isAbsolute(filename) || path.resolve(filename) !== filename
          || !shape(row, ['beforeSha256', 'afterSha256', 'snapshot'])
          || row.beforeSha256 !== row.afterSha256) throw new Error();
      if (row.beforeSha256 === null) {
        if (!authority.newTargets.some((target) => path.join(authority.repository, target) === filename)
            || row.snapshot !== null) throw new Error();
      } else {
        if (!hex(row.beforeSha256) || row.snapshot !== 'captures/' + row.beforeSha256 + '.source') throw new Error();
        expectedCaptures.add(row.beforeSha256);
      }
    }
    const overlays = new Map(reviewed.files.map((row) => [row.target, row]));
    for (const [relative, row] of Object.entries(meta.sources)) {
      const filename = path.join(authority.repository, relative);
      const overlay = overlays.get(relative);
      const dependency = relative.startsWith('node_modules/') || relative.includes('/node_modules/');
      const packageName = relative.match(/(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/)?.[1];
      const fields = ['filename', 'dependency', 'compiledSha256', 'canonicalBeforeSha256', 'canonicalAfterSha256', 'snapshot'];
      if (overlay) fields.push('receiverFilename', 'receiverBeforeSha256', 'receiverAfterSha256');
      if (!shape(row, fields) || relative.startsWith('/') || path.posix.normalize(relative) !== relative
          || relative.split('/').includes('..') || relative.includes('\\') || relative.includes('\0')
          || row.filename !== filename || row.dependency !== dependency
          || (dependency ? !authority.packages.includes(packageName)
            : !authority.sourceRoots.some((root) => relative.startsWith(root)))
          || !hex(row.compiledSha256) || row.canonicalBeforeSha256 !== row.canonicalAfterSha256
          || meta.observed[filename]?.beforeSha256 !== row.canonicalBeforeSha256
          || row.snapshot !== 'captures/' + row.compiledSha256 + '.source') throw new Error();
      if (overlay) {
        if (row.canonicalBeforeSha256 !== overlay.canonicalSha256
            || row.compiledSha256 !== overlay.replacementSha256
            || row.receiverFilename !== path.join(reviewed.receiverRoot, overlay.source)
            || row.receiverBeforeSha256 !== row.compiledSha256 || row.receiverAfterSha256 !== row.compiledSha256
            || meta.observed[row.receiverFilename]?.beforeSha256 !== row.compiledSha256) throw new Error();
      } else if (row.compiledSha256 !== row.canonicalBeforeSha256) throw new Error();
      expectedCaptures.add(row.compiledSha256);
    }
    for (const target of authority.requiredTargets) if (!meta.sources[target]) throw new Error();
    if (expectedCaptures.size !== captures.size) throw new Error();
    for (const [sha256, bytes] of captures) {
      if (!expectedCaptures.has(sha256) || !Buffer.isBuffer(bytes) || bytes.length > 16_000_000
          || digest(bytes) !== sha256) throw new Error();
    }
    const graph = parse(metafileBytes, 2_000_000);
    if (meta.metafileSha256 !== digest(metafileBytes) || !shape(graph, ['inputs', 'outputs'])) throw new Error();
    const inputs = Object.keys(graph.inputs).filter((name) => !['<stdin>', 'empty-server-only:server-only'].includes(name));
    if (!isDeepStrictEqual(inputs.sort(), Object.keys(meta.sources).sort())) throw new Error();
    const outputs = Object.entries(graph.outputs);
    if (outputs.length !== 1 || outputs[0][0] !== meta.output.filename
        || outputs[0][1].bytes !== bundleBytes.length
        || !isDeepStrictEqual(outputs[0][1].exports, [authority.exportName])) throw new Error();
    for (const row of [...Object.values(graph.inputs), ...Object.values(graph.outputs)]) {
      for (const imported of row.imports) {
        if (imported.external && imported.path !== 'pg-native'
            && !cores.has(imported.path.replace(/^node:/, ''))) throw new Error();
      }
    }
    return { manifest: meta, bundleSha256: meta.output.sha256, manifestSha256: reviewedManifestSha256 };
  } catch {
    throw new Error('Artifact reviewed pin, closure, frozen overlays or ABI refused');
  }
}
