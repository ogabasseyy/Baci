// biome-ignore-all format: compact fixed bootstrap fixture stays below the file limit
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { canonicalJson, TASK9_SOURCE_FILES } from './task9-bootstrap.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const AUTHENTIC_IMPORT_CLOSURE = new Set([
  'infra/cwv-runner/archive-index.mjs',
  'infra/cwv-runner/canonical-json.mjs',
  'infra/cwv-runner/exact-run-terminal-cleanup.sh',
  'infra/cwv-runner/rootfs-source-membership.mjs',
  'infra/cwv-runner/rootfs-source-membership-input.mjs',
  'infra/cwv-runner/source-tree-projection.mjs',
]);
const FINAL_CAMPAIGN_CLOSURE = new Set([
  'infra/cwv-runner/campaign-restore-post-commit.sh',
  'infra/cwv-runner/campaign-restore-terminal-receipt.sh',
  'infra/cwv-runner/registration-root-restoration.mjs',
  'infra/cwv-runner/root-runtime-post-egress-recovery.mjs',
]);
const DEFERRED_TASK9_SOURCES = new Set('infra/cwv-runner/archive-link-validation.mjs infra/cwv-runner/archive-stream.mjs infra/cwv-runner/build-image.mjs infra/cwv-runner/campaign-accounting-contract.mjs infra/cwv-runner/campaign-capture-authority.mjs infra/cwv-runner/campaign-cron-tree.mjs infra/cwv-runner/campaign-lease-holder.sh infra/cwv-runner/campaign-network-contract.mjs infra/cwv-runner/campaign-ownership.mjs infra/cwv-runner/campaign-quiesce.sh infra/cwv-runner/campaign-restore-baseline.mjs infra/cwv-runner/campaign-restore-network.mjs infra/cwv-runner/campaign-restore.sh infra/cwv-runner/campaign-source-closure.mjs infra/cwv-runner/campaign-state-collisions.mjs infra/cwv-runner/campaign-state-journal-lock.mjs infra/cwv-runner/campaign-state.mjs infra/cwv-runner/campaign-terminal-cleanup.mjs infra/cwv-runner/campaign-traffic.mjs infra/cwv-runner/canonical-json.mjs infra/cwv-runner/command-settings-contract.mjs infra/cwv-runner/cron-inventory.json infra/cwv-runner/image-archive-authority.mjs infra/cwv-runner/image-process-map.mjs infra/cwv-runner/image-projection-config.mjs infra/cwv-runner/image-projection.mjs infra/cwv-runner/install-prepare-acceptance.mjs infra/cwv-runner/install-prepare-content-cleanup-cli.mjs infra/cwv-runner/install-prepare-content-cleanup.mjs infra/cwv-runner/install-prepare-content-safety.mjs infra/cwv-runner/install-prepare-runtime-receipt.mjs infra/cwv-runner/install-prepare-store.mjs infra/cwv-runner/policy.schema.mjs infra/cwv-runner/registration-token-mount.mjs infra/cwv-runner/rootfs-projection-contract.mjs infra/cwv-runner/rootfs-source-inventory.mjs infra/cwv-runner/runner-runtime-archive-snapshot.mjs infra/cwv-runner/runner-runtime-identity-manifest.mjs infra/cwv-runner/runner-runtime-manifest-producer.mjs infra/cwv-runner/runner-runtime-manifest-receipt-reader.mjs infra/cwv-runner/runner-runtime-projection.mjs infra/cwv-runner/runner-runtime-receipt-contract.mjs infra/cwv-runner/source-archive.mjs infra/cwv-runner/source-manifest.mjs infra/cwv-runner/vps-ssh.sh'.split(' '));

function octal(header, offset, width, value) {
  header.write(value.toString(8).padStart(width - 1, '0'), offset, width - 1);
  header[offset + width - 1] = 0;
}

function checksum(header) {
  header.fill(0x20, 148, 156);
  header.write(
    header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0'),
    148
  );
  header[154] = 0;
  header[155] = 0x20;
}

function tarEntry(path, bytes, mode) {
  const header = Buffer.alloc(512);
  const slash = path.lastIndexOf('/');
  const [prefix, name] =
    Buffer.byteLength(path) <= 100
      ? ['', path]
      : [path.slice(0, slash), path.slice(slash + 1)];
  header.write(name, 0);
  header.write(prefix, 345);
  octal(header, 100, 8, Number.parseInt(mode.slice(3), 8));
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, bytes.length);
  octal(header, 136, 12, 0);
  header.write('ustar\0', 257);
  header.write('00', 263);
  octal(header, 329, 8, 0);
  octal(header, 337, 8, 0);
  header[156] = 0;
  checksum(header);
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}

function deferredSource(path) {
  if (path.endsWith('canonical-json.mjs')) return 'export const canonicalJson = () => "{}"; export const canonicalSha256 = () => "0".repeat(64);\n';
  if (path.endsWith('source-archive.mjs')) return 'import { canonicalJson } from "./canonical-json.mjs"; void canonicalJson; export const createSourceArchive = () => Buffer.alloc(0); export const verifySourceArchive = () => {};\n';
  if (path.endsWith('source-manifest.mjs')) return 'import { canonicalJson } from "./canonical-json.mjs"; import { createSourceArchive, verifySourceArchive } from "./source-archive.mjs"; void canonicalJson; void createSourceArchive; void verifySourceArchive;\n';
  return path.endsWith('.sh') ? '#!/bin/sh\nexit 64\n' : path.endsWith('.json') ? '{}\n' : 'export {};\n';
}

function runtimeSources() {
  return Object.fromEntries([...TASK9_SOURCE_FILES, ...FINAL_CAMPAIGN_CLOSURE].map((path) => {
    if (path === 'infra/cwv-runner/vps-ssh.sh') return [path, Buffer.from('#!/bin/sh\nexit 64\n')];
    try { return [path, readFileSync(new URL(`./${basename(path)}`, import.meta.url))]; }
    catch (error) { if (AUTHENTIC_IMPORT_CLOSURE.has(path) || !DEFERRED_TASK9_SOURCES.has(path) && !FINAL_CAMPAIGN_CLOSURE.has(path) || error?.code !== 'ENOENT') throw error; return [path, Buffer.from(deferredSource(path))]; }
  }));
}

function archiveRows(source, policyBytes) {
  return [...TASK9_SOURCE_FILES, ...FINAL_CAMPAIGN_CLOSURE, 'infra/cwv-runner/policy.json']
    .sort()
    .map((path) => ({
      bytes:
        source[path] ?? (path.endsWith('/policy.json') ? policyBytes : Buffer.from('{}\n')),
      mode: path.endsWith('.sh') ? '100755' : '100644',
      path,
    }));
}

function envelopeFor({ archive, node, rows, source }) {
  const runtime = {
    bootstrapSha256: digest(source['infra/cwv-runner/task9-bootstrap.mjs']),
    launcherSha256: digest(source['infra/cwv-runner/task9-bootstrap-runtime.mjs']),
    nodeProvenanceSha256: '',
    nodeSha256: digest(node),
    nodeVersion: process.version,
  };
  const provenance = {
    archiveSha256: '4'.repeat(64),
    artifact: 'node',
    checksumSha256: '1'.repeat(64),
    keyringSha256: '2'.repeat(64),
    schemaVersion: 1,
    sha256: runtime.nodeSha256,
    executableSha256: runtime.nodeSha256,
    signatureSha256: '3'.repeat(64),
    version: runtime.nodeVersion,
  };
  runtime.nodeProvenanceSha256 = digest(canonicalJson(provenance));
  runtime.runtimeSha256 = digest(
    canonicalJson({
      bootstrapSha256: runtime.bootstrapSha256,
      launcherSha256: runtime.launcherSha256,
      nodeProvenanceSha256: runtime.nodeProvenanceSha256,
      nodeSha256: runtime.nodeSha256,
      nodeVersion: runtime.nodeVersion,
    })
  );
  const policy = rows.find(({ path }) => path.endsWith('/policy.json'));
  const transport = rows.find(({ path }) =>
    path.endsWith('/owner-api-transport.mjs')
  );
  return {
    envelope: {
      bundleId: 'task9-bundle-9',
      base: { ref: 'refs/heads/main', sha: 'a'.repeat(40) },
      deploymentSha: 'b'.repeat(40),
      exactRun: {
        admissionId: 'c'.repeat(64),
        workflow: {
          id: 1,
          path: '.github/workflows/cwv-runner-attestation.yml',
          ref: 'refs/heads/main',
        },
      },
      generation: 1,
      mergeSha: 'd'.repeat(40),
      policy: { path: policy.path, sha256: digest(policy.bytes) },
      pullRequest: { headRef: 'h0/task9', number: 9 },
      purpose: 'task9-exact-run',
      ref: 'refs/pull/9/merge',
      repository: { id: 1100488586, name: 'ogabasseyy/Baci' },
      reviewedSha: 'e'.repeat(40),
      runtime,
      schemaVersion: 1,
      source: { archiveSha256: digest(archive) },
      transactionId: 'task9-test',
      transport: { path: transport.path, sha256: digest(transport.bytes) },
    },
    provenance,
  };
}

export function createExactBootstrapBundle(
  root,
  {
    policyBytes = Buffer.from(
      `{"authority":{},"supplyChain":{"node":{"ownerDarwinArm64Sha256":"${'4'.repeat(64)}"}},"supplyChainProvenance":{"node":{"checksumsSha256":"${'1'.repeat(64)}","keyringSha256":"${'2'.repeat(64)}","signatureSha256":"${'3'.repeat(64)}"}}}`
    ),
  } = {}
) {
  const bundleDir = join(root, 'bundle');
  const launcher = join(root, 'task9-bootstrap-launcher.mjs');
  const publishDir = join(root, 'authorized-source');
  mkdirSync(bundleDir);
  const source = runtimeSources();
  writeFileSync(launcher, source['infra/cwv-runner/task9-bootstrap-runtime.mjs'], { mode: 0o400 });
  chmodSync(launcher, 0o400);
  const rows = archiveRows(source, policyBytes);
  const archive = Buffer.concat([
    ...rows.map((row) => tarEntry(row.path, row.bytes, row.mode)),
    Buffer.alloc(1024),
  ]);
  const node = readFileSync(process.execPath);
  const { envelope, provenance } = envelopeFor({ archive, node, rows, source });
  const manifest = Buffer.from(canonicalJson({
    authority: {},
    baseSha: 'a'.repeat(40),
    entries: [],
    mergeSha: 'd'.repeat(40),
    policyCanonicalSha256: digest(canonicalJson(JSON.parse(policyBytes))),
    policyFileSha256: digest(rows.find(({ path }) => path.endsWith('/policy.json')).bytes),
    prNumber: 9,
    reviewedHeadSha: 'e'.repeat(40),
    schemaVersion: 1,
    sourceArchive: {
      entries: rows.map(({ mode, path, bytes }) => ({ blobSha256: digest(bytes), mode, path })),
      prefix: 'infra/cwv-runner/',
    },
  }));
  const files = {
    'manifest.json': manifest,
    'manifest.sha256': Buffer.from(`${digest(manifest)}  manifest.json\n`),
    'source.tar': archive,
    'source.tar.sha256': Buffer.from(`${digest(archive)}  source.tar\n`),
    'task9-bootstrap.mjs': source['infra/cwv-runner/task9-bootstrap.mjs'],
    node,
    'node-provenance.json': Buffer.from(canonicalJson(provenance)),
  };
  envelope.source.manifestSha256 = digest(manifest);
  envelope.payload = {
    entries: Object.keys(files).sort().map((name) => ({
      mode: name === 'node' ? '100500' : '100400',
      path: `payload/${name}`,
      sha256: digest(files[name]),
      type: 'file',
    })),
  };
  for (const [name, bytes] of Object.entries(files)) {
    const mode = name === 'node' ? 0o500 : 0o400;
    const path = join(bundleDir, name);
    writeFileSync(path, bytes, { mode });
    chmodSync(path, mode);
  }
  const envelopePath = join(root, 'envelope.json');
  const digestPath = join(root, 'envelope.sha256');
  writeFileSync(envelopePath, canonicalJson(envelope), { mode: 0o400 });
  writeFileSync(digestPath, `${digest(readFileSync(envelopePath))}\n`, {
    mode: 0o400,
  });
  return {
    bootstrap: join(bundleDir, 'task9-bootstrap.mjs'),
    bundleId: envelope.bundleId,
    bundleDir,
    digestPath,
    envelopeSha256: digest(readFileSync(envelopePath)),
    envelopePath,
    launcher,
    launcherSha256: digest(readFileSync(launcher)),
    publishDir,
    node: join(bundleDir, 'node'),
  };
}
