import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { authority } from './constants.mjs';
import { createSourceCapture } from './source-capture.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'replay-overlay-synthetic-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'canonical');
  const receiver = path.join(directory, 'receiver');
  await mkdir(receiver);
  await mkdir(path.dirname(path.join(repository, authority.entry)), { recursive: true });
  const target = authority.requiredTargets[0];
  const original = Buffer.from('export const normalized = "canonical";');
  const replacement = Buffer.from('export const normalized = "synthetic-native";');
  await writeFile(path.join(repository, target), original);
  await writeFile(path.join(receiver, 'normalizer.ts'), replacement);
  await writeFile(path.join(repository, authority.entry),
    'import { normalized } from "./prefunded-card-provider-evidence-normalize"; '
    + 'export const createPrefundedCardReplayRuntime = () => normalized;');
  const overlays = [{ target, canonicalSha256: digest(original), replacementSha256: digest(replacement),
    filename: path.join(receiver, 'normalizer.ts') }];
  return { directory, repository, receiver, target, original, overlays };
}
async function compile(fixtureValue, capture) {
  return build({ absWorkingDir: fixtureValue.repository, entryPoints: [authority.entry], bundle: true,
    platform: 'node', target: 'node22', format: 'esm', write: false, metafile: true,
    banner: { js: authority.banner }, plugins: [capture.plugin], logLevel: 'silent' });
}

test('compiles synthetic overlay bytes without modifying canonical files and records pre/post capture', async (context) => {
  const value = await fixture(context);
  const capture = await createSourceCapture({ repository: value.repository, overlays: value.overlays });
  const result = await compile(value, capture);
  const sealed = await capture.seal(result.metafile);
  assert.equal(sealed.sources[value.target].compiledSha256, value.overlays[0].replacementSha256);
  assert.equal(sealed.sources[value.target].canonicalBeforeSha256, value.overlays[0].canonicalSha256);
  assert.equal(sealed.sources[value.target].canonicalAfterSha256, value.overlays[0].canonicalSha256);
  assert.equal(sealed.sources[value.target].receiverAfterSha256, value.overlays[0].replacementSha256);
  assert.deepEqual(await readFile(path.join(value.repository, value.target)), value.original);
  assert.match(result.outputFiles[0].text, /createRequire/);
  assert.match(result.outputFiles[0].text, /synthetic-native/);
  assert.deepEqual(result.metafile.outputs['stdin.js']?.exports ?? Object.values(result.metafile.outputs)[0].exports,
    ['createPrefundedCardReplayRuntime']);
});

test('refuses canonical or receiver drift after capture', async (context) => {
  for (const changed of ['canonical', 'receiver']) {
    const value = await fixture(context);
    const capture = await createSourceCapture({ repository: value.repository, overlays: value.overlays });
    const result = await compile(value, capture);
    await writeFile(changed === 'canonical' ? path.join(value.repository, value.target)
      : value.overlays[0].filename, 'export const normalized = "drift";');
    await assert.rejects(capture.seal(result.metafile), /changed during capture/);
  }
});

test('refuses tampered replacement bytes, symlinked overlay and unused declared overlay', async (context) => {
  const value = await fixture(context);
  await assert.rejects(createSourceCapture({ repository: value.repository,
    overlays: [{ ...value.overlays[0], replacementSha256: '0'.repeat(64) }] }), /overlay source pin/);
  const link = path.join(value.receiver, 'link.ts');
  await symlink(value.overlays[0].filename, link);
  await assert.rejects(createSourceCapture({ repository: value.repository,
    overlays: [{ ...value.overlays[0], filename: link }] }), /regular source/);
  const capture = await createSourceCapture({ repository: value.repository, overlays: value.overlays });
  await writeFile(path.join(value.repository, authority.entry),
    'export const createPrefundedCardReplayRuntime = () => "fixture";');
  const result = await compile(value, capture);
  await assert.rejects(capture.seal(result.metafile), /unused overlay/);
});

test('refuses packages, source roots and external imports outside worker policy', async (context) => {
  for (const statement of ['import "axios";', 'import "../../../../../outside.ts";']) {
    const value = await fixture(context);
    await writeFile(path.join(value.repository, authority.entry), statement +
      'export const createPrefundedCardReplayRuntime = () => "fixture";');
    const capture = await createSourceCapture({ repository: value.repository, overlays: [] });
    if (statement.includes('axios')) {
      const result = await build({ absWorkingDir: value.repository, entryPoints: [authority.entry], bundle: true,
        platform: 'node', format: 'esm', write: false, metafile: true, external: ['axios'],
        plugins: [capture.plugin], logLevel: 'silent' });
      await assert.rejects(capture.seal(result.metafile), /external import/);
    } else {
      await writeFile(path.join(value.directory, 'outside.ts'), 'export const outside = 1;');
      await assert.rejects(compile(value, capture));
    }
  }
});

test('dependency policy exactly matches the pinned worker-renewal source', async () => {
  const policy = await readFile(path.join(authority.repository, authority.workerPolicy), 'utf8');
  assert.equal(digest(policy), authority.workerPolicySha256);
  const listed = policy.match(/const bundledPackageAllowlist = new Set\(\[([\s\S]*?)\]\);/)[1];
  const packages = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...authority.packages].sort(), packages.sort());
});

test('resolves two absent canonical helpers virtually and never creates canonical files', async (context) => {
  const value = await fixture(context);
  await mkdir(path.join(value.repository, 'apps/web/src/schemas'), { recursive: true });
  const overlays = [];
  for (const target of authority.newTargets) {
    const filename = path.join(value.receiver, target.includes('/schemas/') ? 'schema.ts' : 'helper.ts');
    const bytes = Buffer.from(target.includes('/schemas/') ? 'export const shape = "synthetic";'
      : 'import {shape} from "@/schemas/prefunded-card-signed-outflow"; export const result = shape;');
    await writeFile(filename, bytes);
    overlays.push({ target, filename, canonicalSha256: null, replacementSha256: digest(bytes) });
  }
  await writeFile(path.join(value.repository, authority.entry),
    'import {result} from "./prefunded-card-signed-outflow"; export const createPrefundedCardReplayRuntime = () => result;');
  const capture = await createSourceCapture({ repository: value.repository, overlays });
  const result = await compile(value, capture);
  const sealed = await capture.seal(result.metafile);
  for (const target of authority.newTargets) {
    assert.equal(sealed.sources[target].canonicalBeforeSha256, null);
    assert.equal(sealed.sources[target].canonicalAfterSha256, null);
    await assert.rejects(readFile(path.join(value.repository, target)), { code: 'ENOENT' });
  }
  await writeFile(path.join(value.repository, authority.newTargets[0]), 'unexpected canonical new file');
  await assert.rejects(capture.seal(result.metafile), /remain absent/);
});
