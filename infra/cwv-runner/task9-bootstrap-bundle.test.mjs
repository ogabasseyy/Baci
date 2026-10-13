import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  authorizeTask9Bundle,
  BUNDLE_ENTRIES,
  canonicalJson,
  readBundleFiles,
} from './task9-bootstrap.mjs';
import { createTask9BundleFixture } from './task9-bootstrap-bundle-fixture.mjs';

const { cleanupBaseline, generate, hash, input, clonedInputs } =
  createTask9BundleFixture();
after(cleanupBaseline);

test('generates the exact sealed bundle accepted by the real Task 9 authorizer', () => {
  const fixture = clonedInputs();
  const outputRoot = join(
    tmpdir(),
    'baci-cwv-task9-bootstrap-task9-transaction-deterministic'
  );
  rmSync(outputRoot, { force: true, recursive: true });
  try {
    const previousGitDir = Reflect.get(process.env, 'GIT_DIR');
    const previousGitWorkTree = Reflect.get(process.env, 'GIT_WORK_TREE');
    const previousPath = process.env.PATH;
    Reflect.set(process.env, 'GIT_DIR', join(fixture.root, 'attacker.git'));
    Reflect.set(process.env, 'GIT_WORK_TREE', fixture.root);
    process.env.PATH = fixture.root;
    let generated;
    try {
      generated = generate(input(fixture, outputRoot), {
        outputParent: tmpdir(),
      });
    } finally {
      if (previousGitDir === undefined)
        Reflect.deleteProperty(process.env, 'GIT_DIR');
      else Reflect.set(process.env, 'GIT_DIR', previousGitDir);
      if (previousGitWorkTree === undefined)
        Reflect.deleteProperty(process.env, 'GIT_WORK_TREE');
      else Reflect.set(process.env, 'GIT_WORK_TREE', previousGitWorkTree);
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
    const payload = join(outputRoot, 'payload');
    assert.deepEqual(readdirSync(payload).sort(), [...BUNDLE_ENTRIES].sort());
    for (const name of BUNDLE_ENTRIES)
      assert.equal(
        statSync(join(payload, name)).mode & 0o777,
        name === 'node' ? 0o500 : 0o400
      );
    assert.equal(
      readFileSync(join(payload, 'manifest.sha256'), 'utf8'),
      `${hash(readFileSync(join(payload, 'manifest.json')))}  manifest.json\n`
    );
    assert.equal(
      readFileSync(join(payload, 'source.tar.sha256'), 'utf8'),
      `${hash(readFileSync(join(payload, 'source.tar')))}  source.tar\n`
    );
    const envelopeBytes = readFileSync(generated.envelopePath);
    assert.equal(
      envelopeBytes.toString(),
      canonicalJson(JSON.parse(envelopeBytes))
    );
    const authorized = authorizeTask9Bundle({
      bundleId: generated.bundleId,
      envelopeBytes,
      envelopeSha256: generated.envelopeSha256,
      files: readBundleFiles(payload, process.getuid()),
      owner: process.getuid(),
      reviewedEnvelopeSha256: generated.envelopeSha256,
    });
    assert.equal(
      authorized.receipt.sourceBinding.deploymentSha,
      fixture.reviewedSha
    );
    assert.equal(
      authorized.receipt.transactionId,
      'task9-transaction-deterministic'
    );
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
test('refuses drifted digests and invalid source archive entry shapes', () => {
  const fixture = clonedInputs();
  const outputRoot = join(
    tmpdir(),
    'baci-cwv-task9-bootstrap-task9-transaction-deterministic'
  );
  rmSync(outputRoot, { force: true, recursive: true });
  try {
    assert.throws(
      () =>
        generate(
          { ...input(fixture, outputRoot), deploymentSha: 'f'.repeat(40) },
          { outputParent: tmpdir() }
        ),
      /source identity/
    );
    writeFileSync(fixture.paths.manifestDigest, `${'0'.repeat(64)}\n`);
    assert.throws(
      () => generate(input(fixture, outputRoot), { outputParent: tmpdir() }),
      /manifest|digest/
    );
    assert.throws(() => statSync(outputRoot), /ENOENT/);
    const manifest = JSON.parse(readFileSync(fixture.paths.manifest));
    manifest.sourceArchive.entries = {};
    const bytes = Buffer.from(canonicalJson(manifest));
    writeFileSync(fixture.paths.manifest, bytes);
    writeFileSync(fixture.paths.manifestDigest, `${hash(bytes)}\n`);
    assert.throws(
      () => generate(input(fixture, outputRoot), { outputParent: tmpdir() }),
      /invalid frozen manifest/
    );
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
test('refuses Node provenance that is not the policy-signed identity', () => {
  const fixture = clonedInputs();
  const outputRoot = join(
    tmpdir(),
    'baci-cwv-task9-bootstrap-task9-transaction-deterministic'
  );
  rmSync(outputRoot, { force: true, recursive: true });
  try {
    const provenance = JSON.parse(readFileSync(fixture.nodeProvenance));
    provenance.archiveSha256 = '0'.repeat(64);
    chmodSync(fixture.nodeProvenance, 0o600);
    writeFileSync(fixture.nodeProvenance, canonicalJson(provenance));
    chmodSync(fixture.nodeProvenance, 0o400);
    assert.throws(
      () => generate(input(fixture, outputRoot), { outputParent: tmpdir() }),
      /Node provenance/
    );
    assert.throws(() => statSync(outputRoot), /ENOENT/);
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
test('refuses a coordinated pathname swap between held reads and source verification', () => {
  const fixture = clonedInputs();
  const transactionId = 'task9-coordinated-swap';
  const outputRoot = join(
    tmpdir(),
    `baci-cwv-task9-bootstrap-${transactionId}`
  );
  rmSync(outputRoot, { force: true, recursive: true });
  try {
    const validManifest = readFileSync(fixture.paths.manifest);
    const validDigest = readFileSync(fixture.paths.manifestDigest);
    const changed = JSON.parse(validManifest);
    changed.entries = [
      ...changed.entries,
      { absent: true, path: 'attacker-selected', status: 'D' },
    ];
    const changedBytes = Buffer.from(canonicalJson(changed));
    writeFileSync(fixture.paths.manifest, changedBytes);
    writeFileSync(fixture.paths.manifestDigest, `${hash(changedBytes)}\n`);
    assert.throws(
      () =>
        generate(
          {
            ...input(fixture, outputRoot),
            transactionId,
          },
          {
            beforeVerify() {
              writeFileSync(fixture.paths.manifest, validManifest);
              writeFileSync(fixture.paths.manifestDigest, validDigest);
            },
            outputParent: tmpdir(),
          }
        ),
      /source changed during verification/
    );
    assert.throws(() => statSync(outputRoot), /ENOENT/);
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
test('does not delete external output when exclusive mkdir loses a race', () => {
  const fixture = clonedInputs();
  const transactionId = 'task9-output-race';
  const outputRoot = join(
    tmpdir(),
    `baci-cwv-task9-bootstrap-${transactionId}`
  );
  const marker = join(outputRoot, 'external');
  rmSync(outputRoot, { force: true, recursive: true });
  try {
    assert.throws(
      () =>
        generate(
          { ...input(fixture, outputRoot), transactionId },
          {
            outputParent: tmpdir(),
            makeOutputDirectory(path, options) {
              mkdirSync(path, options);
              writeFileSync(marker, 'external');
              throw new Error('external mkdir won');
            },
          }
        ),
      /external mkdir won/
    );
    assert.equal(readFileSync(marker, 'utf8'), 'external');
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
