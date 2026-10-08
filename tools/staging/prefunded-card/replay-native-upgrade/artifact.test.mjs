import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { verifyArtifact } from './artifact.mjs';
import { authority } from './constants.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value));
function fixture() {
  const entry = Buffer.from('synthetic-canonical-entry');
  const bundleBytes = Buffer.from(authority.banner + '\nexport const createPrefundedCardReplayRuntime = 1;');
  const inventoryBytes = readFileSync(authority.frozenInventory);
  const inventory = JSON.parse(inventoryBytes);
  const observed = {};
  const sources = {};
  const captures = new Map([[digest(entry), entry]]);
  for (const target of [authority.entry, ...authority.requiredTargets]) {
    const overlay = inventory.productionDelta.find((row) => row.path === path.join(inventory.receiverRoot, target));
    const filename = path.join(authority.repository, target);
    const compiled = overlay ? readFileSync(overlay.path) : entry;
    const original = overlay ? overlay.canonicalImportSha256 === null ? null : readFileSync(filename) : entry;
    const compiledSha256 = digest(compiled);
    const canonicalHash = original ? digest(original) : null;
    captures.set(compiledSha256, compiled);
    if (original) captures.set(canonicalHash, original);
    observed[filename] = { beforeSha256: canonicalHash, afterSha256: canonicalHash,
      snapshot: canonicalHash ? 'captures/' + canonicalHash + '.source' : null };
    sources[target] = { filename, dependency: false, compiledSha256,
      canonicalBeforeSha256: canonicalHash, canonicalAfterSha256: canonicalHash,
      snapshot: 'captures/' + compiledSha256 + '.source' };
    if (overlay) {
      const receiverFilename = overlay.path;
      Object.assign(sources[target], { receiverFilename,
        receiverBeforeSha256: compiledSha256, receiverAfterSha256: compiledSha256 });
      observed[receiverFilename] = { beforeSha256: compiledSha256, afterSha256: compiledSha256,
        snapshot: 'captures/' + compiledSha256 + '.source' };
    }
  }
  const metafileBytes = json({ inputs: Object.fromEntries([
    ['<stdin>', { bytes: 1, imports: [] }], ...Object.keys(sources).map((name) => [name, { imports: [] }]),
  ]), outputs: { 'prefunded-replay-bundle.mjs': { bytes: bundleBytes.length,
    exports: [authority.exportName], imports: [] } } });
  const virtualEntryBytes = Buffer.from(`export { ${authority.exportName} } from './${authority.entry}';`);
  const manifest = { schemaVersion: 1, status: 'compiled-artifact-only', deadline: authority.deadline,
    repository: authority.repository, entry: authority.entry, exports: [authority.exportName],
    build: { platform: 'node', format: 'esm', target: 'node22', external: ['pg-native'],
      bannerSha256: digest(authority.banner), virtualEntrySha256: digest(virtualEntryBytes),
      esbuildVersion: '0.25.0', hostNodeVersion: 'v24.11.1' },
    reviewedInventorySha256: digest(inventoryBytes), inventory, predecessors: authority.predecessors,
    parentBaseline: authority.parentBaseline, scope: authority.scope,
    output: { filename: 'prefunded-replay-bundle.mjs', sha256: digest(bundleBytes) },
    sources, observed, metafileSha256: digest(metafileBytes),
    installed: false, providerCalled: false, sqlExecuted: false };
  return { manifest, bundleBytes, inventoryBytes, metafileBytes, virtualEntryBytes, captures };
}
function verify(value, pin) {
  const manifestBytes = json(value.manifest);
  return verifyArtifact({ ...value, manifestBytes, reviewedManifestSha256: pin ?? digest(manifestBytes) });
}

test('checks a synthetic reviewed artifact against every captured original and overlay byte', () => {
  const value = fixture();
  assert.equal(verify(value).bundleSha256, digest(value.bundleBytes));
});

test('rejects unreviewed manifests, modified bundle, missing/extra/tampered captures', () => {
  assert.throws(() => verify(fixture(), '0'.repeat(64)), /Artifact/);
  const changed = fixture();
  changed.bundleBytes = Buffer.from('changed');
  assert.throws(() => verify(changed), /Artifact/);
  for (const change of ['missing', 'extra', 'tampered']) {
    const value = fixture();
    const first = value.captures.keys().next().value;
    if (change === 'missing') value.captures.delete(first);
    if (change === 'extra') value.captures.set('f'.repeat(64), Buffer.from('extra'));
    if (change === 'tampered') value.captures.set(first, Buffer.from('wrong'));
    assert.throws(() => verify(value), /Artifact/);
  }
});

test('rejects widened scope, changed predecessor, source drift, missing source and new external', () => {
  for (const change of ['scope', 'predecessor', 'drift', 'missing', 'extraSource', 'external', 'metafile']) {
    const value = fixture();
    if (change === 'scope') value.manifest.scope = { ...authority.scope, batchSize: 1 };
    if (change === 'predecessor') value.manifest.predecessors = { ...authority.predecessors, config: 'f'.repeat(64) };
    if (change === 'drift') value.manifest.sources[authority.entry].canonicalAfterSha256 = 'f'.repeat(64);
    if (change === 'missing') delete value.manifest.sources[authority.entry];
    if (change === 'extraSource') value.manifest.sources['apps/web/src/proxy.ts'] = value.manifest.sources[authority.entry];
    if (change === 'external') {
      const meta = JSON.parse(value.metafileBytes);
      meta.outputs['prefunded-replay-bundle.mjs'].imports.push({ external: true, path: 'axios' });
      value.metafileBytes = json(meta);
      value.manifest.metafileSha256 = digest(value.metafileBytes);
    }
    if (change === 'metafile') value.metafileBytes = Buffer.from('{}');
    assert.throws(() => verify(value), /Artifact/);
  }
});
