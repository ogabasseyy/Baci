import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freezeSourceManifest } from './source-manifest.mjs';
import { canonicalJson } from './task9-bootstrap.mjs';
import { generateTask9BootstrapBundle } from './task9-bootstrap-bundle.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const cwd = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function frozenInputs() {
  const root = mkdtempSync(join(tmpdir(), 'task9-generator-input-'));
  chmodSync(root, 0o700);
  const reviewedSha = git('rev-parse', 'HEAD');
  let baseSha;
  try {
    baseSha = git('rev-parse', 'HEAD^');
  } catch (error) {
    rmSync(root, { force: true, recursive: true });
    throw new Error('task9 fixture requires a non-shallow checkout', {
      cause: error,
    });
  }
  const paths = {
    manifest: join(root, 'frozen-manifest.json'),
    manifestDigest: join(root, 'frozen-manifest.sha256'),
    sourceArchive: join(root, 'frozen-source.tar'),
    sourceArchiveDigest: join(root, 'frozen-source.sha256'),
  };
  freezeSourceManifest({
    baseSha,
    cwd,
    mergeSha: reviewedSha,
    output: paths.manifest,
    outputDigest: paths.manifestDigest,
    prNumber: 3297,
    reviewedHeadSha: reviewedSha,
    sourceArchive: paths.sourceArchive,
    sourceArchiveDigest: paths.sourceArchiveDigest,
  });
  const policy = JSON.parse(
    execFileSync(
      'git',
      ['show', `${reviewedSha}:infra/cwv-runner/policy.json`],
      { cwd, encoding: 'utf8' }
    )
  );
  const node = Buffer.from('authorized Darwin Node 24.18.0 fixture');
  const provenance = {
    archiveSha256: policy.supplyChain.node.ownerDarwinArm64Sha256,
    artifact: 'node',
    checksumSha256: policy.supplyChainProvenance.node.checksumsSha256,
    keyringSha256: policy.supplyChainProvenance.node.keyringSha256,
    schemaVersion: 1,
    sha256: hash(node),
    executableSha256: hash(node),
    signatureSha256: policy.supplyChainProvenance.node.signatureSha256,
    version: policy.supplyChain.node.version,
  };
  const nodePath = join(root, 'node');
  const nodeArchivePath = join(root, 'node.tar.xz');
  const nodeProvenance = join(root, 'node-provenance.json');
  const prMetadataPath = join(root, 'pr-metadata.json');
  const prMetadataDigestPath = join(root, 'pr-metadata.sha256');
  const prMetadata = Buffer.from(
    canonicalJson({
      baseSha,
      headRef: 'codex/h0-cwv-integration',
      mergeSha: reviewedSha,
      number: 3297,
      reviewedHeadSha: reviewedSha,
      workflowId: 987654,
    })
  );
  writeFileSync(prMetadataPath, prMetadata, { mode: 0o600 });
  const prMetadataSha256 = hash(prMetadata);
  writeFileSync(prMetadataDigestPath, `${prMetadataSha256}\n`, { mode: 0o600 });
  const authorityReceiptPath = join(root, 'authority-receipt.json');
  const authorityReceiptDigestPath = join(root, 'authority-receipt.sha256');
  const authorityReceipt = Buffer.from(
    canonicalJson({
      coherence: 'success',
      deploymentSha: reviewedSha,
      metadataSha256: prMetadataSha256,
      repository: { id: 1100488586, name: 'ogabasseyy/Baci' },
      status: 'success',
      workflow: {
        id: 987654,
        path: '.github/workflows/deploy.yml',
        sha: reviewedSha,
      },
    })
  );
  writeFileSync(authorityReceiptPath, authorityReceipt, { mode: 0o600 });
  writeFileSync(authorityReceiptDigestPath, `${hash(authorityReceipt)}\n`, {
    mode: 0o600,
  });
  writeFileSync(nodePath, node, { mode: 0o500 });
  writeFileSync(nodeArchivePath, 'test archive bytes', { mode: 0o400 });
  writeFileSync(nodeProvenance, canonicalJson(provenance), { mode: 0o400 });
  return {
    baseSha,
    nodeArchivePath,
    nodePath,
    nodeProvenance,
    paths,
    prMetadataDigestPath,
    prMetadataPath,
    prMetadataSha256,
    authorityReceiptDigestPath,
    authorityReceiptPath,
    authorityReceiptSha256: hash(authorityReceipt),
    reviewedSha,
    root,
  };
}

function clone(source) {
  const root = mkdtempSync(join(tmpdir(), 'task9-generator-clone-'));
  chmodSync(root, 0o700);
  const paths = Object.fromEntries(
    Object.entries(source.paths).map(([name, sourcePath]) => {
      const target = join(root, name);
      cpSync(sourcePath, target);
      chmodSync(target, 0o600);
      return [name, target];
    })
  );
  const nodePath = join(root, 'node');
  const nodeArchivePath = join(root, 'node.tar.xz');
  const nodeProvenance = join(root, 'node-provenance.json');
  const prMetadataPath = join(root, 'pr-metadata.json');
  const prMetadataDigestPath = join(root, 'pr-metadata.sha256');
  const authorityReceiptPath = join(root, 'authority-receipt.json');
  const authorityReceiptDigestPath = join(root, 'authority-receipt.sha256');
  cpSync(source.nodePath, nodePath);
  cpSync(source.nodeArchivePath, nodeArchivePath);
  cpSync(source.nodeProvenance, nodeProvenance);
  cpSync(source.prMetadataPath, prMetadataPath);
  cpSync(source.prMetadataDigestPath, prMetadataDigestPath);
  cpSync(source.authorityReceiptPath, authorityReceiptPath);
  cpSync(source.authorityReceiptDigestPath, authorityReceiptDigestPath);
  chmodSync(nodePath, 0o500);
  chmodSync(nodeArchivePath, 0o400);
  chmodSync(nodeProvenance, 0o400);
  return {
    baseSha: source.baseSha,
    nodeArchivePath,
    nodePath,
    nodeProvenance,
    paths,
    prMetadataDigestPath,
    prMetadataPath,
    prMetadataSha256: source.prMetadataSha256,
    authorityReceiptDigestPath,
    authorityReceiptPath,
    authorityReceiptSha256: source.authorityReceiptSha256,
    reviewedSha: source.reviewedSha,
    root,
  };
}

export function createTask9BundleFixture() {
  let baseline;
  const getBaseline = () => (baseline ??= frozenInputs());
  const clonedInputs = () => clone(getBaseline());
  const input = (fixture, outputRoot) => ({
    admissionId: 'a'.repeat(64),
    authorityReceiptDigestPath: fixture.authorityReceiptDigestPath,
    authorityReceiptPath: fixture.authorityReceiptPath,
    bundleId: 'task9-bundle-deterministic',
    cwd,
    deploymentSha: fixture.reviewedSha,
    generation: 0,
    headRef: 'codex/h0-cwv-integration',
    nodeArchivePath: fixture.nodeArchivePath,
    nodePath: fixture.nodePath,
    nodeProvenancePath: fixture.nodeProvenance,
    outputRoot,
    prMetadataDigestPath: fixture.prMetadataDigestPath,
    prMetadataPath: fixture.prMetadataPath,
    reviewedPrMetadataSha256: fixture.prMetadataSha256,
    sourceArchiveDigestPath: fixture.paths.sourceArchiveDigest,
    sourceArchivePath: fixture.paths.sourceArchive,
    sourceManifestDigestPath: fixture.paths.manifestDigest,
    sourceManifestPath: fixture.paths.manifest,
    transactionId: 'task9-transaction-deterministic',
    workflowId: 987654,
    verifyGithub: (endpoint) =>
      endpoint.includes('/pulls/')
        ? {
            base: {
              ref: 'main',
              repo: { full_name: 'ogabasseyy/Baci' },
              sha: fixture.baseSha,
            },
            head: { ref: 'codex/h0-cwv-integration', sha: fixture.reviewedSha },
            merge_commit_sha: fixture.reviewedSha,
            merged: true,
            merged_at: '2026-08-12T00:00:00Z',
            number: 3297,
            state: 'closed',
          }
        : endpoint.includes('/actions/workflows/')
          ? { id: 987654, path: '.github/workflows/cwv-runner-attestation.yml' }
          : endpoint.endsWith('/jobs?per_page=100')
            ? { jobs: [{ conclusion: 'success', name: 'deploy-production' }] }
            : {
                conclusion: 'success',
                event: 'push',
                head_branch: 'main',
                head_sha: fixture.reviewedSha,
                id: 987654,
                path: '.github/workflows/deploy.yml',
                repository: { full_name: 'ogabasseyy/Baci', id: 1100488586 },
                status: 'completed',
              },
  });
  const generate = (value, options = {}) =>
    generateTask9BootstrapBundle(value, {
      verifyNodeArchive: () => undefined,
      ...options,
    });
  return Object.freeze({
    cleanupBaseline: () =>
      baseline && rmSync(baseline.root, { force: true, recursive: true }),
    clonedInputs,
    cwd,
    generate,
    hash,
    input,
  });
}
