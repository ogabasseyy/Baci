// biome-ignore-all format: compact source authorization fixture stays below the file limit
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TRANSPORT_SOURCE_FILES } from './owner-api-transport-source.mjs';
import { authorizeTask9Bundle, BUNDLE_ENTRIES, canonicalJson, parseUstar, publishAuthorizedTree, TASK9_SOURCE_FILES } from './task9-bootstrap.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const owner = 501;
const file = (bytes, mode = '100400') => ({ bytes: Buffer.from(bytes), mode, owner, symlink: false });
const authenticClosure = new Map(
  ['archive-index.mjs', 'canonical-json.mjs', 'rootfs-source-membership.mjs', 'rootfs-source-membership-input.mjs', 'source-tree-projection.mjs'].map((name) => [
    `infra/cwv-runner/${name}`,
    readFileSync(new URL(`./${name}`, import.meta.url)),
  ])
);
function putOctal(header, offset, width, value) {
  header.write(value.toString(8).padStart(width - 1, '0'), offset, width - 1, 'ascii');
  header[offset + width - 1] = 0;
} function checksum(header) { header.fill(0x20, 148, 156); header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0'), 148, 'ascii'); header[154] = 0; header[155] = 0x20; } function tarEntry(path, bytes, mode = '100644') {
  const header = Buffer.alloc(512);
  const slash = path.lastIndexOf('/');
  const [prefix, name] = Buffer.byteLength(path) <= 100 ? ['', path] : [path.slice(0, slash), path.slice(slash + 1)];
  header.write(name, 0, 'ascii'); header.write(prefix, 345, 'ascii');
  putOctal(header, 100, 8, Number.parseInt(mode.slice(3), 8));
  putOctal(header, 108, 8, 0); putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, bytes.length);
  putOctal(header, 136, 12, 0);
  header.write('ustar\0', 257, 'ascii'); header.write('00', 263, 'ascii');
  putOctal(header, 329, 8, 0); putOctal(header, 337, 8, 0);
  header[156] = 0;
  checksum(header);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
} function sourceTar(entries) { return Buffer.concat([...entries.map(({ path, bytes, mode }) => tarEntry(path, bytes, mode)), Buffer.alloc(1024)]); } function fixture({ extra = [], omit } = {}) {
  const policy = { authority: {}, supplyChain: { node: { ownerDarwinArm64Sha256: '4'.repeat(64) } }, supplyChainProvenance: { node: { checksumsSha256: '1'.repeat(64), keyringSha256: '2'.repeat(64), signatureSha256: '3'.repeat(64) } } }; const policyBytes = Buffer.from(canonicalJson(policy));
  const sourceEntries = [...TASK9_SOURCE_FILES, 'infra/cwv-runner/policy.json']
    .filter((path) => path !== omit)
    .concat(Array.isArray(extra) ? extra : [extra])
    .map((path) => ({ bytes: authenticClosure.get(path) ?? (path.endsWith('policy.json') ? policyBytes : Buffer.from(path.endsWith('.sh') ? '#!/bin/sh\nexit 64\n' : path.endsWith('task9-bootstrap-runtime.mjs') ? 'launcher source\n' : path.endsWith('task9-bootstrap.mjs') ? 'bootstrap source\n' : 'export {};\n')), mode: path.endsWith('.sh') ? '100755' : '100644', path }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const archive = sourceTar(sourceEntries);
  const node = Buffer.from('pinned node bytes');
  const bootstrap = Buffer.from('bootstrap source\n');
  const launcher = Buffer.from('launcher source\n');
  const archiveEntries = sourceEntries.map(({ path, bytes, mode }) => ({
    path,
    mode,
    sha256: sha256(bytes),
  }));
  const source = { archiveSha256: sha256(archive) };
  const runtime = {
    bootstrapSha256: sha256(bootstrap),
    launcherSha256: sha256(launcher),
    nodeProvenanceSha256: '',
    nodeSha256: sha256(node),
    nodeVersion: '24.18.0',
  };
  const provenance = { archiveSha256: '4'.repeat(64),
    schemaVersion: 1,
    artifact: 'node',
    checksumSha256: '1'.repeat(64),
    keyringSha256: '2'.repeat(64),
    sha256: runtime.nodeSha256, executableSha256: runtime.nodeSha256,
    signatureSha256: '3'.repeat(64),
    version: runtime.nodeVersion,
  };
  runtime.nodeProvenanceSha256 = sha256(canonicalJson(provenance));
  runtime.runtimeSha256 = sha256(canonicalJson({ bootstrapSha256: runtime.bootstrapSha256, launcherSha256: runtime.launcherSha256, nodeProvenanceSha256: runtime.nodeProvenanceSha256, nodeSha256: runtime.nodeSha256, nodeVersion: runtime.nodeVersion }));
  const envelope = {
    bundleId: 'task9-bundle-9',
    schemaVersion: 1,
    purpose: 'task9-exact-run',
    repository: { id: 1100488586, name: 'ogabasseyy/Baci' },
    ref: 'refs/pull/9/merge',
    reviewedSha: 'a'.repeat(40),
    mergeSha: 'c'.repeat(40),
    deploymentSha: 'd'.repeat(40),
    generation: 1,
    transactionId: 'baci-cwv-1',
    base: { ref: 'refs/heads/main', sha: 'b'.repeat(40) },
    pullRequest: { number: 9, headRef: 'h0/task9' },
    exactRun: {
      admissionId: 'e'.repeat(64),
      workflow: {
        id: 2,
        path: '.github/workflows/cwv-runner-attestation.yml',
        ref: 'refs/heads/main',
      },
    },
    policy: {
      path: 'infra/cwv-runner/policy.json',
      sha256: sha256(policyBytes),
    },
    runtime,
    transport: {
      path: 'infra/cwv-runner/owner-api-transport.mjs',
      sha256: sha256(Buffer.from('export {};\n')),
    },
    source,
  };
  const manifest = {
    authority: {},
    baseSha: 'b'.repeat(40),
    entries: [],
    mergeSha: 'c'.repeat(40),
    policyCanonicalSha256: sha256(canonicalJson(policy)),
    policyFileSha256: sha256(policyBytes),
    prNumber: 9,
    reviewedHeadSha: 'a'.repeat(40),
    schemaVersion: 1,
    sourceArchive: {
      entries: archiveEntries.map(({ mode, path, sha256: blobSha256 }) => ({ blobSha256, mode, path })),
      prefix: 'infra/cwv-runner/',
    },
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const files = {
    'manifest.json': file(manifestBytes),
    'manifest.sha256': file(`${sha256(manifestBytes)}  manifest.json\n`),
    'source.tar': file(archive),
    'source.tar.sha256': file(`${sha256(archive)}  source.tar\n`),
    'task9-bootstrap.mjs': file(bootstrap),
    node: file(node, '100500'),
    'node-provenance.json': file(canonicalJson(provenance)),
  };
  envelope.source.manifestSha256 = sha256(manifestBytes);
  envelope.payload = { entries: Object.keys(files).sort().map((name) => ({ mode: files[name].mode, path: `payload/${name}`, sha256: sha256(files[name].bytes), type: 'file' })) };
  return { archiveEntries, envelope, files, manifest, policy };
}
function rechecksum(value) { checksum(value.subarray(0, 512)); }
test('canonical JSON is deterministic and rejects unsupported values', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => canonicalJson({ value: undefined }), /unsupported/);
});
test('declares the only seven permitted offline bootstrap payload entries', () => {
  assert.deepEqual(BUNDLE_ENTRIES, ['manifest.json', 'manifest.sha256', 'source.tar', 'source.tar.sha256', 'task9-bootstrap.mjs', 'node', 'node-provenance.json']);
});
test('declares a closed self-contained bootstrap and post-authorization source inventory', async () => { assert.deepEqual(TASK9_SOURCE_FILES, 'infra/cwv-runner/archive-index.mjs infra/cwv-runner/archive-link-validation.mjs infra/cwv-runner/archive-stream.mjs infra/cwv-runner/build-image.mjs infra/cwv-runner/campaign-accounting-contract.mjs infra/cwv-runner/campaign-capture-authority.mjs infra/cwv-runner/campaign-cron-tree.mjs infra/cwv-runner/campaign-lease-holder.sh infra/cwv-runner/campaign-network-contract.mjs infra/cwv-runner/campaign-ownership.mjs infra/cwv-runner/campaign-quiesce.sh infra/cwv-runner/campaign-restore-baseline.mjs infra/cwv-runner/campaign-restore-network.mjs infra/cwv-runner/campaign-restore.sh infra/cwv-runner/campaign-source-closure.mjs infra/cwv-runner/campaign-state-collisions.mjs infra/cwv-runner/campaign-state-journal-lock.mjs infra/cwv-runner/campaign-state.mjs infra/cwv-runner/campaign-terminal-cleanup.mjs infra/cwv-runner/campaign-traffic.mjs infra/cwv-runner/canonical-json.mjs infra/cwv-runner/command-settings-contract.mjs infra/cwv-runner/cron-inventory.json infra/cwv-runner/exact-run-accounting.mjs infra/cwv-runner/exact-run-contract-cli.mjs infra/cwv-runner/exact-run-contract.mjs infra/cwv-runner/exact-run-controller.sh infra/cwv-runner/exact-run-live-sample-contract.mjs infra/cwv-runner/exact-run-process-contract.mjs infra/cwv-runner/exact-run-rearm-contract.mjs infra/cwv-runner/exact-run-terminal-cleanup.sh infra/cwv-runner/exact-run-transition-contract.mjs infra/cwv-runner/image-archive-authority.mjs infra/cwv-runner/image-process-map.mjs infra/cwv-runner/image-projection-config.mjs infra/cwv-runner/image-projection.mjs infra/cwv-runner/install-prepare-acceptance.mjs infra/cwv-runner/install-prepare-content-cleanup-cli.mjs infra/cwv-runner/install-prepare-content-cleanup.mjs infra/cwv-runner/install-prepare-content-safety.mjs infra/cwv-runner/install-prepare-runtime-receipt.mjs infra/cwv-runner/install-prepare-store.mjs infra/cwv-runner/owner-api-transport-cli-state.mjs infra/cwv-runner/owner-api-transport-evidence.mjs infra/cwv-runner/owner-api-transport-failure.mjs infra/cwv-runner/owner-api-transport-hold.mjs infra/cwv-runner/owner-api-transport-http.mjs infra/cwv-runner/owner-api-transport-operation-evidence.mjs infra/cwv-runner/owner-api-transport-pagination.mjs infra/cwv-runner/owner-api-transport-primitives.mjs infra/cwv-runner/owner-api-transport-requests.mjs infra/cwv-runner/owner-api-transport-runtime.mjs infra/cwv-runner/owner-api-transport-security.mjs infra/cwv-runner/owner-api-transport-source.mjs infra/cwv-runner/owner-api-transport-zip.mjs infra/cwv-runner/owner-api-transport.mjs infra/cwv-runner/owner-dispatch.sh infra/cwv-runner/policy.schema.mjs infra/cwv-runner/registration-token-mount.mjs infra/cwv-runner/rootfs-projection-contract.mjs infra/cwv-runner/rootfs-source-inventory.mjs infra/cwv-runner/rootfs-source-membership-input.mjs infra/cwv-runner/rootfs-source-membership.mjs infra/cwv-runner/runner-runtime-archive-snapshot.mjs infra/cwv-runner/runner-runtime-identity-manifest.mjs infra/cwv-runner/runner-runtime-manifest-producer.mjs infra/cwv-runner/runner-runtime-manifest-receipt-reader.mjs infra/cwv-runner/runner-runtime-projection.mjs infra/cwv-runner/runner-runtime-receipt-contract.mjs infra/cwv-runner/source-archive.mjs infra/cwv-runner/source-manifest-git.mjs infra/cwv-runner/source-manifest-objects.mjs infra/cwv-runner/source-manifest-tree.mjs infra/cwv-runner/source-manifest.mjs infra/cwv-runner/source-tree-projection.mjs infra/cwv-runner/task9-bootstrap-runtime.mjs infra/cwv-runner/task9-bootstrap.mjs infra/cwv-runner/task9-owner-documents.mjs infra/cwv-runner/task9-source-authorization.mjs infra/cwv-runner/verify-owner-cli.sh infra/cwv-runner/vps-ssh.sh'.split(' ')); assert.deepEqual(TRANSPORT_SOURCE_FILES.filter((path) => !TASK9_SOURCE_FILES.includes(path)), []); const source = await (await import('node:fs/promises')).readFile(new URL('./task9-bootstrap.mjs', import.meta.url), 'utf8'); assert.doesNotMatch(source, /from '\.\/task9-ustar\.mjs'|import\('\.\/task9-bootstrap-runtime\.mjs'\)/); });
test('verifies detached digests and complete binding before parsing or publication', () => {
  const value = fixture();
  const envelopeBytes = Buffer.from(canonicalJson(value.envelope));
  const authorized = authorizeTask9Bundle({
    bundleId: value.envelope.bundleId,
    envelopeBytes,
    envelopeSha256: sha256(envelopeBytes), reviewedEnvelopeSha256: sha256(envelopeBytes),
    files: value.files,
    owner,
  });
  assert.equal(
    authorized.receiptBytes.toString(),
    canonicalJson(authorized.receipt)
  );
  assert.deepEqual(
    [...authorized.tree.keys()],
    value.archiveEntries.map((entry) => entry.path)
  );
  assert.throws(() => authorizeTask9Bundle({ bundleId: value.envelope.bundleId, envelopeBytes, envelopeSha256: sha256(envelopeBytes), reviewedEnvelopeSha256: '0'.repeat(64), files: value.files, owner }), /envelope digest/);
  assert.equal(
    authorized.tree.get('infra/cwv-runner/policy.json').mode,
    '100644'
  );
  assert.deepEqual(
    authorized.receipt.sourceFiles.map(({ path }) => path),
    TASK9_SOURCE_FILES
  );
  const names = Object.keys(value.files).sort();
  const aliases = new Proxy(value.files, { getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }), ownKeys: () => [`${names[0]},${names[1]}`, ...names.slice(2)] });
  assert.throws(() => authorizeTask9Bundle({ bundleId: value.envelope.bundleId, envelopeBytes, envelopeSha256: sha256(envelopeBytes), reviewedEnvelopeSha256: sha256(envelopeBytes), files: aliases, owner }), /invalid payload/);

  const drift = fixture();
  drift.files['manifest.sha256'] = file(`${'0'.repeat(64)}  manifest.json\n`);
  assert.throws(
    () =>
      authorizeTask9Bundle({
        bundleId: value.envelope.bundleId,
        envelopeBytes,
        envelopeSha256: sha256(envelopeBytes),
        reviewedEnvelopeSha256: sha256(envelopeBytes),
        files: drift.files,
        owner,
      }),
    /reviewed payload/
  );
  const provenance = fixture();
  provenance.files.node = file('other pinned node', '100500');
  assert.throws(
    () =>
      authorizeTask9Bundle({
        bundleId: value.envelope.bundleId,
        envelopeBytes,
        envelopeSha256: sha256(envelopeBytes),
        reviewedEnvelopeSha256: sha256(envelopeBytes),
        files: provenance.files,
        owner,
      }),
    /reviewed payload/
  );
});
test('requires every Task9 source while authenticating the complete Task5 archive', () => { for (const [key, replacement] of [['prNumber', 10], ['baseSha', 'f'.repeat(40)], ['reviewedHeadSha', 'e'.repeat(40)], ['mergeSha', '1'.repeat(40)], ['policyFileSha256', '2'.repeat(64)], ['policyCanonicalSha256', '3'.repeat(64)], ['authority', { unreviewed: true }]]) { const changed = fixture(); changed.manifest[key] = replacement; const manifestBytes = Buffer.from(canonicalJson(changed.manifest)); changed.files['manifest.json'] = file(manifestBytes); changed.files['manifest.sha256'] = file(`${sha256(manifestBytes)}  manifest.json\n`); changed.envelope.source.manifestSha256 = sha256(manifestBytes); changed.envelope.payload = { entries: Object.keys(changed.files).sort().map((name) => ({ mode: changed.files[name].mode, path: `payload/${name}`, sha256: sha256(changed.files[name].bytes), type: 'file' })) }; const envelopeBytes = Buffer.from(canonicalJson(changed.envelope)); assert.throws(() => authorizeTask9Bundle({ bundleId: changed.envelope.bundleId, envelopeBytes, envelopeSha256: sha256(envelopeBytes), reviewedEnvelopeSha256: sha256(envelopeBytes), files: changed.files, owner }), /source binding/); }
  for (const omit of TASK9_SOURCE_FILES) { const value = fixture({ omit }); const envelopeBytes = Buffer.from(canonicalJson(value.envelope)); assert.throws(() => authorizeTask9Bundle({ bundleId: value.envelope.bundleId, envelopeBytes, envelopeSha256: sha256(envelopeBytes), reviewedEnvelopeSha256: sha256(envelopeBytes), files: value.files, owner }), /source archive/); }
  const extra = ['infra/cwv-runner/campaign-restore-post-commit.sh', 'infra/cwv-runner/registration-root-restoration.mjs', ...Array.from({ length: 52 }, (_entry, index) => `infra/cwv-runner/task5-closure-${String(index).padStart(3, '0')}.mjs`)]; const added = fixture({ extra }); const addedBytes = Buffer.from(canonicalJson(added.envelope));
  const authorized = authorizeTask9Bundle({ bundleId: added.envelope.bundleId, envelopeBytes: addedBytes, envelopeSha256: sha256(addedBytes), reviewedEnvelopeSha256: sha256(addedBytes), files: added.files, owner }); assert.equal(authorized.tree.size > 128, true); assert.ok(authorized.tree.has('infra/cwv-runner/registration-root-restoration.mjs'));
  const stale = fixture({ extra }); stale.manifest.sourceArchive.entries = stale.manifest.sourceArchive.entries.filter(({ path }) => path !== 'infra/cwv-runner/registration-root-restoration.mjs'); const manifestBytes = Buffer.from(canonicalJson(stale.manifest)); stale.files['manifest.json'] = file(manifestBytes); stale.files['manifest.sha256'] = file(`${sha256(manifestBytes)}  manifest.json\n`); stale.envelope.source.manifestSha256 = sha256(manifestBytes); stale.envelope.payload = { entries: Object.keys(stale.files).sort().map((name) => ({ mode: stale.files[name].mode, path: `payload/${name}`, sha256: sha256(stale.files[name].bytes), type: 'file' })) }; const staleBytes = Buffer.from(canonicalJson(stale.envelope));
  assert.throws(() => authorizeTask9Bundle({ bundleId: stale.envelope.bundleId, envelopeBytes: staleBytes, envelopeSha256: sha256(staleBytes), reviewedEnvelopeSha256: sha256(staleBytes), files: stale.files, owner }), /tar/);
  const substituted = fixture(); const archive = Buffer.from(substituted.files['source.tar'].bytes); archive[512] ^= 1; substituted.files['source.tar'] = file(archive); substituted.files['source.tar.sha256'] = file(`${sha256(archive)}  source.tar\n`); substituted.envelope.source.archiveSha256 = sha256(archive); substituted.envelope.payload = { entries: Object.keys(substituted.files).sort().map((name) => ({ mode: substituted.files[name].mode, path: `payload/${name}`, sha256: sha256(substituted.files[name].bytes), type: 'file' })) }; const substitutedBytes = Buffer.from(canonicalJson(substituted.envelope));
  assert.throws(() => authorizeTask9Bundle({ bundleId: substituted.envelope.bundleId, envelopeBytes: substitutedBytes, envelopeSha256: sha256(substitutedBytes), reviewedEnvelopeSha256: sha256(substitutedBytes), files: substituted.files, owner }), /tar/);
});

test('publishes only the authorized source tree and canonical receipt through injection', () => {
  const value = fixture();
  const envelopeBytes = Buffer.from(canonicalJson(value.envelope));
  const authorized = authorizeTask9Bundle({
    bundleId: value.envelope.bundleId,
    envelopeBytes,
    envelopeSha256: sha256(envelopeBytes),
    reviewedEnvelopeSha256: sha256(envelopeBytes),
    files: value.files,
    owner,
  });
  const writes = [];
  publishAuthorizedTree(authorized, (path, bytes, mode) =>
    writes.push({ path, bytes: bytes.toString(), mode })
  );
  assert.deepEqual(
    writes.map(({ path, mode }) => ({ path, mode })),
    [
      ...value.archiveEntries.map(({ path, mode }) => ({ path, mode })),
      { path: 'receipt.json', mode: '100400' },
    ]
  );
  assert.equal(writes.at(-1).bytes, authorized.receiptBytes.toString());
});

test('publishes its sealed authorization, not a caller-modified inspection tree', () => {
  const value = fixture();
  const envelopeBytes = Buffer.from(canonicalJson(value.envelope));
  const authorized = authorizeTask9Bundle({
    bundleId: value.envelope.bundleId,
    envelopeBytes,
    envelopeSha256: sha256(envelopeBytes),
    reviewedEnvelopeSha256: sha256(envelopeBytes),
    files: value.files,
    owner,
  });
  authorized.tree.set('infra/cwv-runner/policy.json', {
    bytes: Buffer.from('tampered'),
    mode: '100644',
  });
  const writes = new Map();
  publishAuthorizedTree(authorized, (path, bytes) => writes.set(path, bytes));
  assert.equal(
    writes.get('infra/cwv-runner/policy.json').toString(),
    canonicalJson(value.policy)
  );
});

test('sealed bootstrap parser rejects noncanonical headers and isolates member bytes', () => {
  const bytes = Buffer.from('safe');
  const expected = [
    {
      path: 'infra/cwv-runner/policy.json',
      mode: '100644',
      sha256: sha256(bytes),
    },
  ];
  const valid = sourceTar([{ ...expected[0], bytes }]);
  const [member] = parseUstar(valid, expected);
  member.bytes[0] = 'X'.charCodeAt(0);
  assert.equal(valid[512], 's'.charCodeAt(0));
  const noncanonical = Buffer.from(valid);
  noncanonical[155] = 0;
  assert.throws(() => parseUstar(noncanonical, expected), /tar/);
  for (const offset of [108, 116, 136, 265, 297, 329, 337, 500]) {
    const metadata = Buffer.from(valid);
    metadata[offset] = '1'.charCodeAt(0);
    rechecksum(metadata);
    assert.throws(() => parseUstar(metadata, expected), /tar/);
  }
  const checksum = Buffer.from(valid);
  checksum[0] ^= 1;
  assert.throws(() => parseUstar(checksum, expected), /tar/);
  const padding = Buffer.from(valid);
  padding[512 + bytes.length] = 1;
  assert.throws(() => parseUstar(padding, expected), /tar/);
  assert.throws(
    () => parseUstar(Buffer.concat([valid, Buffer.alloc(512)]), expected),
    /tar/
  );
  assert.throws(
    () =>
      parseUstar(valid, [
        { ...expected[0], path: 'infra/cwv-runner/../policy.json' },
      ]),
    /tar/
  );
  const link = Buffer.from(valid);
  link[156] = '2'.charCodeAt(0);
  assert.throws(() => parseUstar(link, expected), /tar/);
});
