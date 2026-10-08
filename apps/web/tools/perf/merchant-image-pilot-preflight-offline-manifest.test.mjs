import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { generationIdFor } from '../../../../infra/cdn-transformer/pilot/generation-identity.mjs';
import { checkBindingManifest } from './merchant-image-pilot-preflight-offline-manifest.mjs';
import {
  acceptanceFor,
  boundSourceFixture,
  GENERATION,
  outputRootWith,
  RECORD,
  sha256,
} from './merchant-image-pilot-preflight-offline-output-fixtures.mjs';

describe('checkBindingManifest', () => {
  it('binds manifest source facts to the verified input bytes', async () => {
    const { generationId, inputBytes, manifest, sourceSha } =
      await boundSourceFixture();
    const root = await outputRootWith(manifest, {}, generationId);
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256),
        generationId
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes,
      name: 'bound',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: sourceSha },
    });
    expect(parsed).not.toBeNull();
    expect(failures).toEqual([]);
  });

  it('rejects animated input bytes like the generator does', async () => {
    // Classic 1x1 GIF with its frame block spliced twice (sharp reports
    // pages 2): the pilot certifies stills only.
    const frame = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    const animated = Buffer.concat([
      frame.subarray(0, frame.length - 1),
      frame.subarray(19, frame.length - 1),
      frame.subarray(frame.length - 1),
    ]);
    const { manifest } = await boundSourceFixture();
    // Rebind the manifest to the animated bytes so identity, generation
    // binding, and byte size all pass and the decode guard is what fails.
    manifest.source.bytes = animated.length;
    manifest.source.sha256 = sha256(animated);
    // The fake tiers claim 100 bytes; shrink them under the source so the
    // never-larger contract passes and the decode guard is what fails.
    for (const tier of manifest.tiers) {
      tier.bytes = animated.length;
    }
    const animatedId = generationIdFor({
      encoderIdentity: manifest.encoder,
      job: {
        assetId: manifest.assetId,
        merchantId: RECORD.merchantId,
        role: 'logo',
      },
      recipeId: RECIPE_ID,
      sourceSha256: manifest.source.sha256,
    });
    const root = await outputRootWith(manifest, {}, animatedId);
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256),
        animatedId
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes: animated,
      name: 'animated',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: manifest.source.sha256 },
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/does not decode/);
  });

  it('rejects a header-readable but truncated source', async () => {
    // corrupt-truncated.jpg passes metadata() yet fails pixel decode
    // (generator-rejected input): the source-fact check must force a
    // full decode instead of trusting the header.
    const here = dirname(fileURLToPath(import.meta.url));
    const truncated = await readFile(
      join(
        here,
        '..',
        '..',
        '..',
        '..',
        'infra',
        'cdn-transformer',
        'pilot',
        'fixtures',
        'corrupt-truncated.jpg'
      )
    );
    const { generationId, manifest, sourceSha } = await boundSourceFixture();
    manifest.source.bytes = truncated.length;
    const root = await outputRootWith(manifest, {}, generationId);
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256),
        generationId,
        manifest.tiers.map((tier) => tier.quality)
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes: truncated,
      name: 'truncated',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: sourceSha },
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/does not decode/);
  });

  it('rejects an oversized manifest before parsing it', async () => {
    const { generationId, manifest } = await boundSourceFixture();
    const root = await outputRootWith(manifest, {}, generationId);
    await writeFile(
      join(root, 'generations', generationId, 'manifest.json'),
      Buffer.alloc(2 * 1024 * 1024, 0x7b)
    );
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256),
        generationId,
        manifest.tiers.map((tier) => tier.quality)
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes: Buffer.alloc(10),
      name: 'oversized',
      options: { outputRoot: root },
      record: RECORD,
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/missing or unreadable/);
  });

  it('compares acceptance hashes positionally, not as a sorted set', async () => {
    const { generationId, inputBytes, manifest, sourceSha } =
      await boundSourceFixture();
    const root = await outputRootWith(manifest, {}, generationId);
    const checks = [];
    const failures = [];
    // Same hashes, reversed: a sorted-set comparison would pass, but the
    // runtime matcher binds each hash to one rung positionally.
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256).reverse(),
        generationId
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes,
      name: 'reversed',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: sourceSha },
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/acceptance hashes differ/);
  });

  it('rejects source-fact drift against the verified input', async () => {
    const { generationId, inputBytes, manifest, sourceSha } =
      await boundSourceFixture();
    const record = { ...RECORD, sha256: sourceSha };
    for (const [label, patch, pattern] of [
      ['bytes', { bytes: inputBytes.length + 1 }, /claims .* bytes/],
      ['format', { format: 'jpeg' }, /claims format/],
      ['dims', { orientedWidth: 385 }, /decodes/],
    ]) {
      const root = await outputRootWith(
        {
          ...manifest,
          source: { ...manifest.source, ...patch },
        },
        {},
        generationId
      );
      const checks = [];
      const failures = [];
      const parsed = await checkBindingManifest({
        acceptance: acceptanceFor(
          manifest.tiers.map((tier) => tier.sha256),
          generationId
        ),
        checks,
        effectiveRecipe: RECIPE_ID,
        failures,
        inputBytes,
        name: label,
        options: { outputRoot: root },
        record,
      });
      expect(parsed, label).toBeNull();
      expect(failures.join('\n'), label).toMatch(pattern);
    }
  });

  it('fails closed when the manifest is missing or malformed', async () => {
    const root = await outputRootWith(null);
    for (const [label, setup] of [
      ['missing', async () => root],
      [
        'malformed',
        async () => {
          await writeFile(
            join(root, 'generations', GENERATION, 'manifest.json'),
            JSON.stringify({ assetId: 'logo-a' })
          );
          return root;
        },
      ],
    ]) {
      const checks = [];
      const failures = [];
      const manifest = await checkBindingManifest({
        acceptance: acceptanceFor(['e'.repeat(64)]),
        checks,
        effectiveRecipe: 'pilot/r1',
        failures,
        name: label,
        options: { outputRoot: await setup() },
        record: RECORD,
      });
      expect(manifest, label).toBeNull();
      expect(failures.length, label).toBeGreaterThan(0);
    }
  });

  it('rejects a symlinked generation entry before reading its manifest', async () => {
    // The outside directory carries a fully valid manifest: confinement,
    // not the contract, must reject it.
    const { manifest } = await boundSourceFixture();
    const root = await outputRootWith(null);
    const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
    const moved = join(outside, 'generation');
    await mkdir(moved, { recursive: true });
    await writeFile(join(moved, 'manifest.json'), JSON.stringify(manifest));
    await rm(join(root, 'generations', GENERATION), {
      force: true,
      recursive: true,
    });
    await symlink(moved, join(root, 'generations', GENERATION));
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256),
        GENERATION
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      name: 'symlinked',
      options: { outputRoot: root },
      record: RECORD,
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/escapes the output root/);
  });
});
