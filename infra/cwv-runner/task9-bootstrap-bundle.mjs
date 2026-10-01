// biome-ignore-all format: compact fail-closed generator stays below the 300-line limit
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASK9_SOURCE_MANIFEST_MAX_BYTES, verifySourceManifest } from './source-manifest.mjs';
import { readTask9AuthorityReceipt } from './task9-authority-receipt.mjs';
import { authorizeTask9Bundle, BUNDLE_ENTRIES, canonicalJson, parseUstar, TASK9_PAYLOAD_FILES } from './task9-bootstrap.mjs';
import { checkedTask9Identity } from './task9-bootstrap-identity.mjs';
import { checkedTask9Provenance } from './task9-bootstrap-provenance.mjs';
import { fsyncTask9Directory } from './task9-fsync-directory.mjs';
import { withHeldTask9Checkout } from './task9-held-checkout.mjs';
import { readHeldTask9File } from './task9-held-file.mjs';
import { verifyTask9NodeArchive } from './task9-node-archive.mjs';
import { withTask9OutputDirectory } from './task9-output-directory.mjs';
import { readTask9PrMetadata } from './task9-pr-metadata.mjs';
import { readPublishedTask9Files } from './task9-published-files.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SMALL_INPUT_BYTES = 1_048_576;
const MAX_SOURCE_ARCHIVE_BYTES = 16_777_216;
const MAX_NODE_BYTES = 268_435_456;
const MAX_NODE_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MODES = TASK9_PAYLOAD_FILES;
const CHECKOUT_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new TypeError(message); };
function writeExclusive(path, bytes, mode) {
  const fd = openSync(path, 'wx', mode);
  try {
    writeFileSync(fd, bytes);
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function normalizeDirectory(path) {
  chmodSync(path, 0o700);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fchmodSync(fd, 0o700);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function logicalId(prefix, supplied) {
  const value = supplied ?? `${prefix}-${randomBytes(16).toString('hex')}`;
  if (!ID.test(value)) fail(`invalid ${prefix} id`);
  return value;
}

function checkedTransactionId(supplied) {
  const value = supplied ?? `task9-${randomBytes(16).toString('hex')}`;
  if (!TRANSACTION_ID.test(value)) fail('invalid transaction id');
  return value;
}

export function generateTask9BootstrapBundle(
  input,
  { afterPayloadRead = () => undefined, beforeFinalValidation = () => undefined, beforeVerify = () => undefined, makeOutputDirectory, outputParent = '/private/tmp', verifyNodeArchive = verifyTask9NodeArchive } = {}
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('invalid Task 9 bundle input');
  const transactionId = checkedTransactionId(input.transactionId);
  const bundleId = logicalId('task9-bundle', input.bundleId);
  const outputRoot = resolve(input.outputRoot ?? join(outputParent, `baci-cwv-task9-bootstrap-${transactionId}`));
  if (
    dirname(outputRoot) !== resolve(outputParent) ||
    basename(outputRoot) !== `baci-cwv-task9-bootstrap-${transactionId}` ||
    lstatSync(outputRoot, { throwIfNoEntry: false })
  )
    fail('unsafe Task 9 output');
  let checkout;
  try { checkout = realpathSync(input.cwd); }
  catch { fail('unsafe Task 9 checkout'); }
  if (checkout !== CHECKOUT_ROOT) fail('unsafe Task 9 checkout');
  return withHeldTask9Checkout(checkout, CHECKOUT_ROOT, (checkoutHandle) => {
  const manifestInput = readHeldTask9File(input.sourceManifestPath, 0o600, { maxBytes: TASK9_SOURCE_MANIFEST_MAX_BYTES });
  const manifestDigestInput = readHeldTask9File(input.sourceManifestDigestPath, 0o600, { maxBytes: 256 });
  const archiveInput = readHeldTask9File(input.sourceArchivePath, 0o600, { maxBytes: MAX_SOURCE_ARCHIVE_BYTES });
  const archiveDigestInput = readHeldTask9File(input.sourceArchiveDigestPath, 0o600, { maxBytes: 256 });
  const node = readHeldTask9File(input.nodePath, 0o500, { maxBytes: MAX_NODE_BYTES });
  const nodeArchive = readHeldTask9File(input.nodeArchivePath, 0o400, { maxBytes: MAX_NODE_ARCHIVE_BYTES });
  const nodeProvenance = readHeldTask9File(input.nodeProvenancePath, 0o400, { maxBytes: MAX_SMALL_INPUT_BYTES });
  const prMetadata = readTask9PrMetadata(input.prMetadataPath, input.prMetadataDigestPath, {
    maxBytes: MAX_SMALL_INPUT_BYTES,
    reviewedSha256: input.reviewedPrMetadataSha256,
    verify: input.verifyGithub,
  });
  const authorityReceipt = readTask9AuthorityReceipt(
    input.authorityReceiptPath,
    input.authorityReceiptDigestPath,
    input.verifyGithub
  );
  if (
    !DIGEST.test(manifestDigestInput.bytes.toString().trim()) ||
    manifestDigestInput.bytes.toString() !==
      `${hash(manifestInput.bytes)}\n` ||
    !DIGEST.test(archiveDigestInput.bytes.toString().trim()) ||
    archiveDigestInput.bytes.toString() !== `${hash(archiveInput.bytes)}\n`
  )
    fail('invalid frozen digest');
  let manifest;
  try { manifest = JSON.parse(manifestInput.bytes); }
  catch { fail('invalid frozen manifest'); }
  if (canonicalJson(manifest) !== manifestInput.bytes.toString()) fail('invalid frozen manifest');
  if (
    !manifest.sourceArchive ||
    typeof manifest.sourceArchive !== 'object' ||
    !Array.isArray(manifest.sourceArchive.entries)
  )
    fail('invalid frozen manifest');
  const expected = manifest.sourceArchive.entries.map(({ blobSha256: sha256, mode, path }) => ({ mode, path, sha256 }));
  const rows = parseUstar(archiveInput.bytes, expected);
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const policyRow = byPath.get('infra/cwv-runner/policy.json');
  const transportRow = byPath.get('infra/cwv-runner/owner-api-transport.mjs');
  const bootstrapRow = byPath.get('infra/cwv-runner/task9-bootstrap.mjs');
  const launcherRow = byPath.get('infra/cwv-runner/task9-bootstrap-runtime.mjs');
  if (!policyRow || !transportRow || !bootstrapRow || !launcherRow)
    fail('incomplete Task 9 source archive');
  let policy;
  try {
    policy = JSON.parse(policyRow.bytes);
  } catch {
    fail('invalid Task 9 policy');
  }
  beforeVerify();
  const verifiedManifest = verifySourceManifest({
    baseSha: manifest.baseSha,
    cwd: checkoutHandle,
    input: manifestInput.path,
    inputDigest: manifestDigestInput.path,
    mergeSha: manifest.mergeSha,
    prNumber: manifest.prNumber,
    reviewedHeadSha: manifest.reviewedHeadSha,
    sourceArchive: archiveInput.path,
    sourceArchiveDigest: archiveDigestInput.path,
  });
  if (canonicalJson(verifiedManifest) !== canonicalJson(manifest))
    fail('held source changed during verification');
  checkoutHandle.guard();
  const identity = checkedTask9Identity({ ...input, authorityReceipt }, manifest, policy, prMetadata);
  const provenance = checkedTask9Provenance(
    nodeProvenance.bytes,
    node.bytes,
    nodeArchive.bytes,
    policy,
    verifyNodeArchive
  );
  if (!Number.isSafeInteger(input.generation) || input.generation < 0)
    fail('invalid generation');
  const payload = {
    'manifest.json': manifestInput.bytes,
    'manifest.sha256': Buffer.from(`${hash(manifestInput.bytes)}  manifest.json\n`),
    'node-provenance.json': nodeProvenance.bytes,
    node: node.bytes,
    'source.tar': archiveInput.bytes,
    'source.tar.sha256': Buffer.from(`${hash(archiveInput.bytes)}  source.tar\n`),
    'task9-bootstrap.mjs': bootstrapRow.bytes,
  };
  const runtime = {
    bootstrapSha256: hash(bootstrapRow.bytes),
    launcherSha256: hash(launcherRow.bytes),
    nodeProvenanceSha256: hash(nodeProvenance.bytes),
    nodeSha256: hash(node.bytes),
    nodeVersion: provenance.version,
  };
  runtime.runtimeSha256 = hash(Buffer.from(canonicalJson(runtime)));
  const envelope = {
    base: identity.base,
    bundleId,
    deploymentSha: input.deploymentSha,
    exactRun: identity.exactRun,
    generation: input.generation,
    mergeSha: identity.mergeSha,
    payload: {
      entries: [...BUNDLE_ENTRIES].sort().map((name) => ({
        mode: MODES[name],
        path: `payload/${name}`,
        sha256: hash(payload[name]),
        type: 'file',
      })),
    },
    policy: { path: policyRow.path, sha256: hash(policyRow.bytes) },
    pullRequest: identity.pullRequest,
    purpose: 'task9-exact-run',
    ref: identity.ref,
    repository: identity.repository,
    reviewedSha: identity.reviewedSha,
    runtime,
    schemaVersion: 1,
    source: {
      archiveSha256: hash(archiveInput.bytes),
      manifestSha256: hash(manifestInput.bytes),
    },
    transactionId,
    transport: { path: transportRow.path, sha256: hash(transportRow.bytes) },
  };
  const envelopeBytes = Buffer.from(canonicalJson(envelope));
  const envelopeSha256 = hash(envelopeBytes);
  const memoryFiles = Object.fromEntries(BUNDLE_ENTRIES.map((name) => [name, {
    bytes: payload[name], mode: MODES[name], owner: process.getuid(), symlink: false,
  }]));
  authorizeTask9Bundle({
    bundleId,
    envelopeBytes,
    envelopeSha256,
    files: memoryFiles,
    owner: process.getuid(),
    reviewedEnvelopeSha256: envelopeSha256,
  });
  const payloadDirectory = join(outputRoot, 'payload');
  let heldEnvelope;
  let heldEnvelopeDigest;
  let heldPayload;
  try {
  return withTask9OutputDirectory(outputRoot, () => {
    fsyncTask9Directory(dirname(outputRoot));
    mkdirSync(payloadDirectory, { mode: 0o700 });
    normalizeDirectory(payloadDirectory);
    for (const name of BUNDLE_ENTRIES)
      writeExclusive(
        join(payloadDirectory, name),
        payload[name],
        Number.parseInt(MODES[name].slice(3), 8)
      );
    fsyncTask9Directory(payloadDirectory);
    const envelopePath = join(outputRoot, 'bootstrap-review-envelope.json');
    const envelopeSha256Path = join(outputRoot, 'bootstrap-review-envelope.sha256');
    writeExclusive(envelopePath, envelopeBytes, 0o400);
    writeExclusive(envelopeSha256Path, `${envelopeSha256}\n`, 0o400);
    fsyncTask9Directory(outputRoot);
    fsyncTask9Directory(dirname(outputRoot));
    heldEnvelope = readHeldTask9File(envelopePath, 0o400, { hold: true, maxBytes: MAX_SMALL_INPUT_BYTES });
    heldEnvelopeDigest = readHeldTask9File(envelopeSha256Path, 0o400, { hold: true, maxBytes: 256 });
    if (
      !heldEnvelope.bytes.equals(envelopeBytes) ||
      heldEnvelopeDigest.bytes.toString() !== `${envelopeSha256}\n`
    )
      fail('published envelope changed');
    heldPayload = readPublishedTask9Files(payloadDirectory, process.getuid(), { afterRead: afterPayloadRead });
    authorizeTask9Bundle({
      bundleId,
      envelopeBytes: heldEnvelope.bytes,
      envelopeSha256,
      files: heldPayload.files,
      owner: process.getuid(),
      reviewedEnvelopeSha256: envelopeSha256,
    });
    heldPayload.verify();
    return Object.freeze({
      bundleId,
      envelopePath,
      envelopeSha256,
      envelopeSha256Path,
      outputRoot,
      payloadDirectory,
      transactionId,
    });
  }, {
    afterPublishValidation() {
      beforeFinalValidation();
      checkoutHandle.guard();
      heldPayload?.verify();
      heldEnvelope?.verify();
      heldEnvelopeDigest?.verify();
      if (
        !heldEnvelope?.bytes.equals(envelopeBytes) ||
        !heldEnvelopeDigest?.bytes.equals(Buffer.from(`${envelopeSha256}\n`))
      )
        fail('published envelope changed');
    },
    makeDirectory: makeOutputDirectory,
  });
  } finally {
    heldPayload?.close();
    heldEnvelope?.close();
    heldEnvelopeDigest?.close();
  }
  });
}
