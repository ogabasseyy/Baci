import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { materializeHostedSavings } from './hosted-savings-materialize';

type Runtime = NonNullable<Parameters<typeof materializeHostedSavings>[2]>;
type Verified = Awaited<ReturnType<Runtime['verify']>>;
const hash = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp('/tmp/hosted-savings-materialize-fixture-');
  await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
  const sources = [];
  for (const [index, body] of [
    'SELECT 1;\n',
    'SELECT 2;\n',
    'SELECT 3;\n',
  ].entries()) {
    const repositoryPath = `supabase/migrations/2026091400000${index}_fixture.sql`;
    await writeFile(path.join(root, repositoryPath), body);
    sources.push({
      repositoryPath,
      sha256: hash(body),
      receiptId: String(index),
    });
  }
  const verified = {
    bootstrapSources: sources.slice(0, 1),
    postReplaySources: [],
    manifest: { baseSha: 'a'.repeat(40), pendingSources: sources.slice(2) },
  } as unknown as Verified;
  const runtime: Runtime = {
    verify: async () => verified,
    order: () => sources.slice(0, 2),
  };
  return { root, sources, runtime };
}

test('materializes from ordinal one through current pending sources with verifiable exact bytes', async () => {
  const { root, runtime } = await fixture();
  const bundles: string[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const receipt = await materializeHostedSavings(
        ['--materialize-only'],
        root,
        runtime
      );
      bundles.push(receipt.directory);
      const bytes = await readFile(
        path.join(receipt.directory, 'manifest.json')
      );
      const manifest = JSON.parse(bytes.toString());
      assert.equal(hash(bytes), receipt.manifestSha256);
      assert.equal(manifest.executionAuthorized, false);
      assert.equal(manifest.resumeSupported, false);
      assert.deepEqual(
        manifest.entries.map((entry: { ordinal: number }) => entry.ordinal),
        [1, 2, 3]
      );
      for (const entry of manifest.entries) {
        assert.equal(
          hash(await readFile(path.join(receipt.directory, entry.file))),
          entry.sha256
        );
      }
      assert.equal((await stat(receipt.directory)).mode & 0o777, 0o700);
      assert.equal(receipt.files, 3);
    }
    assert.notEqual(bundles[0], bundles[1]);
    assert.equal(
      await readFile(path.join(bundles[0], 'manifest.json'), 'utf8'),
      await readFile(path.join(bundles[1], 'manifest.json'), 'utf8')
    );
  } finally {
    await Promise.all(
      [root, ...bundles].map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  }
});

test('rejects destinations and resume before verifier invocation', async () => {
  const runtime = {
    verify: async () => {
      throw new Error('must not verify');
    },
  } as unknown as Runtime;
  for (const args of [
    [],
    ['--resume'],
    ['--materialize-only', '/tmp/existing'],
    ['--execute'],
  ])
    await assert.rejects(
      materializeHostedSavings(args, '/tmp', runtime),
      /Only --materialize-only/
    );
});

test('manifest rejection and source hash failure stop without retaining a partial bundle', async () => {
  const { root, sources, runtime } = await fixture();
  const before = (await readdir('/tmp'))
    .filter((name) => name.startsWith('hosted-savings-materialize-'))
    .sort();
  try {
    await writeFile(path.join(root, sources[1].repositoryPath), 'SELECT 999;');
    await assert.rejects(
      materializeHostedSavings(['--materialize-only'], root, runtime),
      /hash mismatch/
    );
    runtime.verify = async () => {
      throw new Error('invalid manifest');
    };
    await assert.rejects(
      materializeHostedSavings(['--materialize-only'], root, runtime),
      /invalid manifest/
    );
    assert.deepEqual(
      (await readdir('/tmp'))
        .filter((name) => name.startsWith('hosted-savings-materialize-'))
        .sort(),
      before
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses the existing replacement engine rather than applying both historical and replacement bodies', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const names = [
    '20260418000000_baseline.sql',
    '20260812173500_quiz_event_results_v2_deny_client_policy.sql',
    '20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql',
  ];
  const sources = await Promise.all(
    names.map(async (name) => {
      const repositoryPath = `supabase/migrations/${name}`;
      return {
        repositoryPath,
        sha256: hash(await readFile(path.join(root, repositoryPath))),
        receiptId: name,
      };
    })
  );
  const verified = {
    bootstrapSources: sources.slice(0, 1),
    postReplaySources: sources.slice(1),
    manifest: { baseSha: 'a'.repeat(40), pendingSources: [] },
  } as unknown as Verified;
  const receipt = await materializeHostedSavings(['--materialize-only'], root, {
    verify: async () => verified,
    order: () => sources.slice(0, 1),
  });
  try {
    const manifest = JSON.parse(
      await readFile(path.join(receipt.directory, 'manifest.json'), 'utf8')
    );
    assert.deepEqual(
      manifest.entries.map((entry: { source: string }) => entry.source),
      [sources[0].repositoryPath, sources[2].repositoryPath]
    );
    assert.equal(manifest.inputs.length, 3);
  } finally {
    await rm(receipt.directory, { recursive: true, force: true });
  }
});
