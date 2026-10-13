import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  new URL('./task9-compose-bundle.sh', import.meta.url),
  'utf8'
);
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const sha256 = (value) =>
  createHash('sha256').update(readFileSync(value)).digest('hex');

function writeNodeArchive(root, nodeBody, version = '24.18.0') {
  const stage = join(root, 'node-stage');
  const memberDir = join(stage, `node-v${version}-darwin-arm64/bin`);
  mkdirSync(memberDir, { recursive: true });
  const memberPath = join(memberDir, 'node');
  writeFileSync(memberPath, nodeBody, { mode: 0o755 });
  const archive = join(root, 'node.tar.xz');
  execFileSync('/usr/bin/tar', [
    '-cJf',
    archive,
    '-C',
    stage,
    `node-v${version}-darwin-arm64/bin/node`,
  ]);
  return archive;
}

test('binds prepared Node to its signed preparation receipt before composition', () => {
  assert.match(source, /node_sha=\$\(sha256 "\$node"\)/);
  assert.match(source, /archive_node_sha=/);
  assert.match(source, /tar -xJOf "\$archive"/);
  assert.match(source, /provenance" executableSha256/);
  assert.match(source, /provenance" archiveSha256/);
  assert.match(source, /"\$\(sha256 "\$node"\)" = "\$node_sha"/);
  assert.match(
    source,
    /exec \/usr\/bin\/env -i HOME="\$HOME" PATH=\/usr\/bin:\/bin "\$node" "\$launcher"/
  );
});

test('requires reviewed hashes for the helper, launcher, composer and GitHub CLI', () => {
  assert.match(source, /sha256 "\$helper"\)" = "\$reviewed_helper"/);
  assert.match(source, /sha256 "\$launcher_source"\)" = "\$reviewed_launcher"/);
  assert.match(source, /sha256 "\$composer"\)" = "\$reviewed_composer"/);
  assert.match(source, /sha256 "\$gh"\)" = "\$github_sha"/);
});

test('invokes the prepared Node with a closed preload-free environment', () => {
  assert.match(
    source,
    /\/usr\/bin\/env -i HOME="\$HOME" PATH=\/usr\/bin:\/bin "\$node" --version/
  );
  assert.match(
    source,
    /exec \/usr\/bin\/env -i HOME="\$HOME" PATH=\/usr\/bin:\/bin "\$node" "\$launcher"/
  );
});

function runComposeBundle(root, policy, gh) {
  execFileSync(join(sourceRoot, 'task9-compose-bundle.sh'), [
    '--transaction-dir',
    root,
    '--policy',
    policy,
    '--reviewed-policy-sha256',
    sha256(policy),
    '--source-root',
    sourceRoot,
    '--reviewed-helper-sha256',
    sha256(join(sourceRoot, 'task9-compose-bundle.sh')),
    '--reviewed-launcher-sha256',
    sha256(join(sourceRoot, 'task9-bootstrap-bundle-launcher.mjs')),
    '--reviewed-composer-sha256',
    sha256(join(sourceRoot, 'task9-bootstrap-bundle-cli.mjs')),
    '--github-sha256',
    sha256(gh),
    '--',
    '--dummy',
    'value',
  ]);
}

function prepareComposeFixture(originalNode) {
  const root = mkdtempSync('/private/tmp/baci-cwv-compose-node-');
  const policy = join(root, 'policy.json');
  const node = join(root, 'prepared-node/node');
  const provenance = join(root, 'prepared-node/node-provenance.json');
  const gh = join(root, 'tools/gh/bin/gh');
  const checksumsSha256 = 'b'.repeat(64);
  const signatureSha256 = 'c'.repeat(64);
  const keyringSha256 = 'd'.repeat(64);
  mkdirSync(dirname(node), { recursive: true });
  mkdirSync(dirname(gh), { recursive: true });
  writeFileSync(node, originalNode, { mode: 0o500 });
  writeFileSync(gh, '#!/bin/sh\nexit 0\n', { mode: 0o500 });
  const archivePath = writeNodeArchive(root, originalNode);
  const archiveSha256 = sha256(archivePath);
  chmodSync(archivePath, 0o400);
  const executableSha256 = sha256(node);
  writeFileSync(
    policy,
    JSON.stringify({
      supplyChain: {
        node: { ownerDarwinArm64Sha256: archiveSha256, version: '24.18.0' },
      },
      supplyChainProvenance: {
        node: { checksumsSha256, keyringSha256, signatureSha256 },
      },
    }),
    { mode: 0o400 }
  );
  writeFileSync(
    provenance,
    JSON.stringify({
      archiveSha256,
      artifact: 'node',
      checksumSha256: checksumsSha256,
      executableSha256,
      keyringSha256,
      schemaVersion: 1,
      sha256: executableSha256,
      signatureSha256,
      version: '24.18.0',
    }),
    { mode: 0o400 }
  );
  return { archivePath, gh, node, policy, provenance, root };
}

test('refuses a prepared Node replaced after its provenance was sealed', {
  skip: process.platform !== 'darwin',
}, () => {
  const originalNode = '#!/bin/sh\nprintf %s v24.18.0\n';
  const { gh, node, policy, root } = prepareComposeFixture(originalNode);
  try {
    chmodSync(node, 0o700);
    writeFileSync(node, '#!/bin/sh\nprintf %s v24.18.0\n# replaced\n');
    chmodSync(node, 0o500);
    assert.throws(
      () => runComposeBundle(root, policy, gh),
      (error) =>
        error.status === 65 &&
        /task9 composition refused/.test(error.stderr.toString())
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('refuses coordinated node and provenance replacement before archive binding', {
  skip: process.platform !== 'darwin',
}, () => {
  const originalNode = '#!/bin/sh\nprintf %s v24.18.0\n';
  const forgedNode = '#!/bin/sh\nprintf %s v24.18.0\n# forged\n';
  const { gh, node, policy, provenance, root } =
    prepareComposeFixture(originalNode);
  try {
    chmodSync(node, 0o700);
    writeFileSync(node, forgedNode);
    chmodSync(node, 0o500);
    const forgedSha256 = sha256(node);
    chmodSync(provenance, 0o600);
    writeFileSync(
      provenance,
      JSON.stringify({
        ...JSON.parse(readFileSync(provenance, 'utf8')),
        executableSha256: forgedSha256,
        sha256: forgedSha256,
      }),
      { mode: 0o400 }
    );
    assert.throws(
      () => runComposeBundle(root, policy, gh),
      (error) =>
        error.status === 65 &&
        /task9 composition refused/.test(error.stderr.toString())
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
