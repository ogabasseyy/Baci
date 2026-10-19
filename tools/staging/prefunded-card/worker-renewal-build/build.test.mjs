import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildWorkerRenewal, verifySourceSnapshots } from './build.mjs';

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);
const legacyNames = ['background.cjs', 'snapshot.cjs', 'readiness.cjs'];

test('builds fresh source bundles with pinned closure, deadline sentinels, and container names', async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'prefunded-worker-renewal-')
  );
  const output = path.join(temporary, 'artifact');
  const tracked = [
    'apps/web/src/scripts/run-prefunded-card-background.ts',
    'tools/staging/prefunded-card/treasury-snapshot-cli.ts',
    'tools/staging/prefunded-card/runtime-readiness-cli.ts',
  ];
  const before = await Promise.all(
    tracked.map(async (file) =>
      (await readFile(path.join(repository, file))).toString('hex')
    )
  );
  try {
    const manifest = await buildWorkerRenewal(output);
    assert.equal(manifest.deadline, '2026-10-06T15:59:10Z');
    assert.equal(manifest.priorDeadline, '2026-09-29T15:59:10Z');
    assert.equal(
      manifest.deadlineAuthority.path,
      'tools/staging/prefunded-card/card-week-renewal/sealed-source.json'
    );
    assert.equal(
      manifest.deadlineAuthority.knownDeadlineSchemaPath,
      'apps/web/src/schemas/prefunded-card-known-deadline.ts'
    );
    assert.deepEqual(
      Object.keys(manifest.outputSha256).sort(),
      [...legacyNames].sort()
    );
    assert.equal(
      Object.keys(manifest.sourceClosureSha256).length > tracked.length,
      true
    );
    assert.deepEqual(manifest.bundledDependencies, ['pg']);
    assert.deepEqual(manifest.externalExternals, ['pg-native']);
    assert.deepEqual(manifest.financialBounds, {
      companySandboxBudgetKobo: 10000,
      originalPrincipalKobo: 10000,
      principalMutation: false,
    });
    assert.deepEqual(manifest.runtimeConstraints, {
      roleLoginRequired: true,
      tls: 'strict',
      rlsBypass: false,
    });
    assert.equal(manifest.changesApplied, false);
    for (const filename of legacyNames) {
      assert.match(
        manifest.containerPaths[filename],
        new RegExp(`/opt/pvb-worker/${filename}$`)
      );
      const digest = manifest.outputSha256[filename];
      const bundle = await readFile(path.join(output, filename));
      assert.equal(createHash('sha256').update(bundle).digest('hex'), digest);
      assert.ok((await stat(path.join(output, filename))).size > 0);
    }
    for (const [source, digest] of Object.entries(
      manifest.sourceClosureSha256
    )) {
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(repository, source)))
          .digest('hex'),
        digest
      );
    }
    const files = await readdir(output);
    assert.deepEqual(
      files.sort(),
      [...legacyNames, 'artifact.manifest.json'].sort()
    );
    const after = await Promise.all(
      tracked.map(async (file) =>
        (await readFile(path.join(repository, file))).toString('hex')
      )
    );
    assert.deepEqual(after, before);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('refuses to reuse an existing artifact directory', async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'prefunded-worker-renewal-')
  );
  try {
    await assert.rejects(buildWorkerRenewal(temporary), /new directory/);
    assert.deepEqual(await readdir(temporary), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('fails when an imported source changes after esbuild captures its bytes', async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'prefunded-worker-source-')
  );
  const source = path.join(temporary, 'source.ts');
  try {
    await writeFile(source, 'export const version = 1;');
    const snapshot = new Map([
      [
        source,
        createHash('sha256')
          .update(await readFile(source))
          .digest('hex'),
      ],
    ]);
    await writeFile(source, 'export const version = 2;');
    await assert.rejects(
      verifySourceSnapshots(snapshot),
      /changed during compilation/
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
