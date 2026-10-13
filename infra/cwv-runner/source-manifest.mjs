// biome-ignore-all format: The Task 5 fixed-tool parser is intentionally compact to remain within the 300-line runtime cap.
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import { createSourceArchive, verifySourceArchive } from './source-archive.mjs';
import { verifyGitObjects } from './source-manifest-objects.mjs';
import { authenticatedTreeRows } from './source-manifest-tree.mjs';

export { createSourceArchive, verifySourceArchive } from './source-archive.mjs';

const PREFIX = 'infra/cwv-runner/';
export const TASK9_SOURCE_MANIFEST_MAX_BYTES = 16_777_216;
export const MAX_GIT_OBJECT_BATCH_BYTES = 64 * 1024 * 1024;
const LIMITS = { archive: TASK9_SOURCE_MANIFEST_MAX_BYTES, members: 1024, member: 1_048_576 };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new TypeError(message);
};
const pathCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const rowIdentity = (row) => row.rawIdentity ?? `${row.rawPath ? 'raw:' : 'utf8:'}${row.path}`;
export function chunkGitObjectIdsBySize(objectIds, sizes, maxBytes = MAX_GIT_OBJECT_BATCH_BYTES) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const objectId of [...new Set(objectIds)]) {
    const size = sizes.get(objectId)?.size;
    if (!Number.isSafeInteger(size) || size < 0) fail('missing Git object size');
    const estimatedBytes = size + objectId.length + 256;
    if (estimatedBytes > maxBytes) fail('Git object exceeds batch size limit');
    if (batch.length && batchBytes + estimatedBytes > maxBytes) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(objectId);
    batchBytes += estimatedBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function verifyGitObjectsChunked(cwd, objectIds, options) {
  const ids = [...new Set(objectIds)];
  if (!ids.length) return new Map();
  if (options?.includeBytes === false) return verifyGitObjects(cwd, ids, options);
  const sizes = new Map(
    [...verifyGitObjects(cwd, ids, { ...options, includeBytes: false })].map(([, value], index) => [ids[index], value])
  );
  const verified = new Map();
  for (const batch of chunkGitObjectIdsBySize(ids, sizes))
    for (const [key, value] of verifyGitObjects(cwd, batch, options)) verified.set(key, value);
  return verified;
}

export function sourceManifestBytes(value) {
  const bytes = Buffer.from(canonicalJson(value));
  if (bytes.length > TASK9_SOURCE_MANIFEST_MAX_BYTES) fail('source manifest exceeds size limit');
  return bytes;
}

function checkedSha(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40,64}$/.test(value)) fail(`invalid ${field}`);
  return value;
}

function blobEntry(cwd, row, verified, maxBytes = LIMITS.member) {
  if (row.rawPath) fail('non-UTF-8 source path');
  if (row.mode !== '100644' && row.mode !== '100755') fail('unsupported Git tree mode');
  const bytes = verified?.get(`${cwd}\0${row.objectId}`)?.bytes;
  if (!bytes) fail('invalid Git blob');
  if (bytes.length > maxBytes) fail('source member exceeds size limit');
  return { path: row.path, mode: row.mode, blobSha256: sha256(bytes), bytes };
}

function changedEntries(cwd, baseSha, reviewedHeadSha, mergeSha) {
  checkedSha(baseSha, 'base SHA');
  checkedSha(reviewedHeadSha, 'reviewed head SHA');
  checkedSha(mergeSha, 'merge SHA');
  const verifiedObjects = verifyGitObjects(cwd, [baseSha, reviewedHeadSha, mergeSha]);
  for (const sha of [baseSha, reviewedHeadSha, mergeSha]) {
    const object = verifiedObjects.get(`${cwd}\0${sha}`);
    if (object?.type !== 'commit') fail('source SHA must name a commit');
  }
  const baseRows = authenticatedTreeRows(cwd, baseSha, { verifyBlobs: false });
  const reviewedRows = authenticatedTreeRows(cwd, reviewedHeadSha, { verifyBlobs: false });
  const mergedRows = authenticatedTreeRows(cwd, mergeSha, { verifyBlobs: false });
  const baseByPath = new Map(baseRows.map((row) => [rowIdentity(row), row]));
  const reviewedByPath = new Map(reviewedRows.map((row) => [rowIdentity(row), row]));
  const mergedByPath = new Map(mergedRows.map((row) => [rowIdentity(row), row]));
  const entries = [];
  const paths = [...new Set([...baseByPath.keys(), ...reviewedByPath.keys()])].sort(pathCompare);
  const changed = [];
  for (const identity of paths) {
    const base = baseByPath.get(identity);
    const reviewed = reviewedByPath.get(identity);
    const path = reviewed?.path ?? base?.path;
    if (base && reviewed && base.mode === reviewed.mode && base.objectId === reviewed.objectId) continue;
    const status = !reviewed ? 'D' : !base ? 'A' : 'M';
    if (status === 'D') {
      if (base?.rawPath) fail('non-UTF-8 source path');
      if (mergedByPath.has(identity)) fail('deleted path remains in merge tree');
      entries.push({ path, status, absent: true });
      continue;
    }
    const merged = mergedByPath.get(identity);
    if (!reviewed || !merged || merged.path !== path) fail('ambiguous changed path');
    changed.push({ merged, path, reviewed, status });
  }
  const verifiedBlobs = verifyGitObjectsChunked(
    cwd,
    changed.flatMap(({ merged, reviewed }) => [reviewed.objectId, merged.objectId])
  );
  for (const { merged, path, reviewed, status } of changed) {
    const entry = blobEntry(cwd, reviewed, verifiedBlobs, LIMITS.archive);
    const mergedBytes = verifiedBlobs.get(`${cwd}\0${merged.objectId}`)?.bytes;
    if (!mergedBytes) fail('invalid Git blob');
    if (entry.mode !== merged.mode || entry.blobSha256 !== sha256(mergedBytes)) fail('merge tree differs from reviewed path');
    entries.push({ path, status, mode: entry.mode, blobSha256: entry.blobSha256 });
  }
  return entries.sort((left, right) => pathCompare(left.path, right.path));
}

function sourceEntries(cwd, mergeSha) {
  const rows = authenticatedTreeRows(cwd, mergeSha, { verifyBlobs: false }).filter(({ path }) => path.startsWith(PREFIX));
  if (rows.some(({ rawPath }) => rawPath)) fail('non-UTF-8 source path');
  const verified = verifyGitObjectsChunked(cwd, rows.map(({ objectId }) => objectId));
  const entries = rows.map((row) => blobEntry(cwd, row, verified));
  if (!entries.length || entries.some((entry) => !entry.path.startsWith(PREFIX))) fail('invalid source archive projection');
  if (entries.find((entry) => entry.path === `${PREFIX}vps-ssh.sh`)?.mode !== '100755')
    fail('vps SSH wrapper must be executable');
  return entries;
}

function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()); }
function policyProjection(policy) {
  if (!exactKeys(policy, ['artifactRetentionDays', 'authority', 'dedicatedRuntime', 'host', 'installationImport', 'networkAccounting', 'processAllowSet', 'repository', 'repositoryAuthority', 'resources', 'ruleset', 'runner', 'schemaVersion', 'supplyChain', 'supplyChainProvenance', 'thresholds', 'workflowActions']) || !Number.isSafeInteger(policy.schemaVersion) || policy.schemaVersion !== 1 || !exactKeys(policy.authority, ['normativeContractPath', 'normativeContractSha256', 'implementationBaseSha', 'deploymentRunId', 'deploymentRunAttempt', 'deploymentMarker'])) fail('invalid reviewed policy schema');
  return policy.authority;
}

function outputPaths(paths) {
  const parent = dirname(paths[0]);
  const directory = lstatSync(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || (directory.mode & 0o077)) fail('unsafe output directory');
  for (const path of paths) if (dirname(path) !== parent || relative(parent, path).includes('/') || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) fail('unsafe output path');
}

function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  if (lstatSync(path, { throwIfNoEntry: false })) fail('refusing existing output');
  writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function policyForTree(cwd, reviewedHeadSha, mergeSha = reviewedHeadSha) {
  const reviewed = authenticatedTreeRows(cwd, reviewedHeadSha, { verifyBlobs: false }).filter(({ path }) => path === `${PREFIX}policy.json`);
  const merged = authenticatedTreeRows(cwd, mergeSha, { verifyBlobs: false }).filter(({ path }) => path === `${PREFIX}policy.json`);
  if (reviewed.length !== 1 || merged.length !== 1 || reviewed[0].path !== `${PREFIX}policy.json` || merged[0].path !== `${PREFIX}policy.json`) fail('ambiguous policy source');
  const verified = verifyGitObjects(cwd, [reviewed[0].objectId, merged[0].objectId]);
  const bytes = verified.get(`${cwd}\0${reviewed[0].objectId}`).bytes;
  if (sha256(bytes) !== sha256(verified.get(`${cwd}\0${merged[0].objectId}`).bytes)) fail('merge policy differs from reviewed tree');
  try { const policy = JSON.parse(bytes); policyProjection(policy); return { policy, policyFileSha256: sha256(bytes) }; }
  catch { fail('invalid reviewed policy'); }
}

export function freezeSourceManifest({ cwd, prNumber, reviewedHeadSha, baseSha, mergeSha, output, outputDigest, sourceArchive, sourceArchiveDigest }) {
  if (!Number.isSafeInteger(Number(prNumber)) || Number(prNumber) <= 0) fail('invalid PR number');
  outputPaths([output, outputDigest, sourceArchive, sourceArchiveDigest]);
  const { policy, policyFileSha256 } = policyForTree(cwd, reviewedHeadSha, mergeSha);
  const entries = changedEntries(cwd, baseSha, reviewedHeadSha, mergeSha);
  const archiveEntries = sourceEntries(cwd, mergeSha);
  const archive = createSourceArchive(archiveEntries);
  const manifest = { schemaVersion: 1, policyFileSha256, policyCanonicalSha256: canonicalSha256(policy), authority: policyProjection(policy), prNumber: Number(prNumber), reviewedHeadSha, baseSha, mergeSha, entries, sourceArchive: { prefix: PREFIX, entries: archiveEntries.map(({ path, mode, blobSha256 }) => ({ path, mode, blobSha256 })) } };
  const bytes = sourceManifestBytes(manifest);
  atomicWrite(output, bytes); atomicWrite(outputDigest, `${sha256(bytes)}\n`); atomicWrite(sourceArchive, archive); atomicWrite(sourceArchiveDigest, `${sha256(archive)}\n`);
  return manifest;
}

export function verifySourceManifest({ cwd, prNumber, reviewedHeadSha, baseSha, mergeSha, input, inputDigest, sourceArchive, sourceArchiveDigest }) {
  outputPaths([input, inputDigest, sourceArchive, sourceArchiveDigest]);
  const digest = readFileSync(inputDigest, 'utf8');
  if (!/^[0-9a-f]{64}\n$/.test(digest)) fail('invalid manifest digest file');
  const bytes = readFileSync(input);
  if (bytes.length > TASK9_SOURCE_MANIFEST_MAX_BYTES) fail('source manifest exceeds size limit');
  if (sha256(bytes) !== digest.trim() || canonicalJson(JSON.parse(bytes)) !== bytes.toString('utf8')) fail('manifest is not canonical');
  const manifest = JSON.parse(bytes);
  const expected = freezeExpected(cwd, prNumber, reviewedHeadSha, baseSha, mergeSha);
  if (canonicalJson(manifest) !== canonicalJson(expected)) fail('manifest identity mismatch');
  const archive = readFileSync(sourceArchive);
  if (readFileSync(sourceArchiveDigest, 'utf8') !== `${sha256(archive)}\n`) fail('invalid source archive digest');
  verifySourceArchive(archive, manifest.sourceArchive.entries);
  return manifest;
}

function preflightExpected(cwd, prNumber, reviewedHeadSha, baseSha) {
  const { policy, policyFileSha256 } = policyForTree(cwd, reviewedHeadSha);
  const entries = changedEntries(cwd, baseSha, reviewedHeadSha, reviewedHeadSha);
  const archiveEntries = sourceEntries(cwd, reviewedHeadSha);
  return { schemaVersion: 'preflight-v1', policyFileSha256, policyCanonicalSha256: canonicalSha256(policy), authority: policyProjection(policy), prNumber: Number(prNumber), reviewedHeadSha, baseSha, sourceArchive: { prefix: PREFIX, entries: archiveEntries.map(({ path, mode, blobSha256 }) => ({ path, mode, blobSha256 })) }, entries };
}

function preflightWrite(manifest, output, outputDigest, sourceArchive, sourceArchiveDigest, cwd, reviewedHeadSha) {
  outputPaths([output, outputDigest, sourceArchive, sourceArchiveDigest]);
  const entries = sourceEntries(cwd, reviewedHeadSha);
  const archive = createSourceArchive(entries);
  const bytes = sourceManifestBytes(manifest);
  atomicWrite(output, bytes); atomicWrite(outputDigest, `${sha256(bytes)}\n`); atomicWrite(sourceArchive, archive); atomicWrite(sourceArchiveDigest, `${sha256(archive)}\n`);
  return manifest;
}

export function freezePreflightSourceManifest({ cwd, prNumber, reviewedHeadSha, baseSha, output, outputDigest, sourceArchive, sourceArchiveDigest }) {
  if (!Number.isSafeInteger(Number(prNumber)) || Number(prNumber) <= 0) fail('invalid PR number');
  return preflightWrite(preflightExpected(cwd, prNumber, reviewedHeadSha, baseSha), output, outputDigest, sourceArchive, sourceArchiveDigest, cwd, reviewedHeadSha);
}

export function verifyPreflightSourceManifest({ cwd, prNumber, reviewedHeadSha, baseSha, input, inputDigest, sourceArchive, sourceArchiveDigest }) {
  outputPaths([input, inputDigest, sourceArchive, sourceArchiveDigest]);
  const bytes = readFileSync(input);
  if (bytes.length > TASK9_SOURCE_MANIFEST_MAX_BYTES) fail('source manifest exceeds size limit');
  const recorded = readFileSync(inputDigest, 'utf8');
  if (!/^[0-9a-f]{64}\n$/.test(recorded) || sha256(bytes) !== recorded.trim()) fail('invalid preflight digest');
  const manifest = JSON.parse(bytes);
  const expected = preflightExpected(cwd, prNumber, reviewedHeadSha, baseSha);
  if (canonicalJson(manifest) !== bytes.toString() || canonicalJson(manifest) !== canonicalJson(expected)) fail('preflight identity mismatch');
  const archive = readFileSync(sourceArchive);
  if (readFileSync(sourceArchiveDigest, 'utf8') !== `${sha256(archive)}\n`) fail('invalid preflight archive digest');
  verifySourceArchive(archive, manifest.sourceArchive.entries); return manifest;
}

function freezeExpected(cwd, prNumber, reviewedHeadSha, baseSha, mergeSha) {
  const { policy, policyFileSha256 } = policyForTree(cwd, reviewedHeadSha, mergeSha);
  const entries = changedEntries(cwd, baseSha, reviewedHeadSha, mergeSha);
  const archiveEntries = sourceEntries(cwd, mergeSha);
  return { schemaVersion: 1, policyFileSha256, policyCanonicalSha256: canonicalSha256(policy), authority: policyProjection(policy), prNumber: Number(prNumber), reviewedHeadSha, baseSha, mergeSha, entries, sourceArchive: { prefix: PREFIX, entries: archiveEntries.map(({ path, mode, blobSha256 }) => ({ path, mode, blobSha256 })) } };
}

function argumentsFor(command) {
  const preflight = command.endsWith('preflight');
  const write = command.startsWith('freeze');
  const names = ['prNumber', 'reviewedHeadSha', 'baseSha', ...(preflight ? [] : ['mergeSha']), ...(write ? ['output', 'outputDigest'] : ['input', 'inputDigest']), 'sourceArchive', 'sourceArchiveDigest'];
  const values = Object.fromEntries(names.map((name) => [name, undefined]));
  const flags = new Map(names.map((name) => [`--${({ prNumber: 'pr-number', reviewedHeadSha: 'reviewed-head', baseSha: 'base', mergeSha: 'merge' })[name] ?? name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, name]));
  const args = process.argv.slice(3);
  if (args.length !== names.length * 2) fail('invalid source-manifest arguments');
  for (let index = 0; index < args.length; index += 2) {
    const key = flags.get(args[index]);
    if (!key || values[key] !== undefined) fail(`invalid source-manifest flag: ${args[index]}`);
    values[key] = args[index + 1];
  }
  return values;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (!['freeze', 'verify', 'freeze-preflight', 'verify-preflight'].includes(command)) fail('usage: source-manifest.mjs freeze|verify|freeze-preflight|verify-preflight');
  const values = { cwd: process.cwd(), ...argumentsFor(command) };
  const result = command === 'freeze' ? freezeSourceManifest(values) : command === 'verify' ? verifySourceManifest(values) : command === 'freeze-preflight' ? freezePreflightSourceManifest(values) : verifyPreflightSourceManifest(values);
  process.stdout.write(`${sha256(canonicalJson(result))}\n`);
}
