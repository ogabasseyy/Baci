import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { assertManifestContract } from './merchant-image-pilot-preflight-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);
const RECIPE = RECIPE_ID;

describe('preflight manifest contract', () => {
  it('agrees with the generator and web schemas on the shared corpus', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    for (const label of [
      'validManifest',
      'validManifestOffset',
      'validManifestGuarded',
    ]) {
      expect(
        assertManifestContract(corpus[label], {
          recipeId: RECIPE,
          role: 'logo',
        }),
        label
      ).toEqual([]);
    }
    for (const [label, candidate] of Object.entries(corpus.invalidManifests)) {
      expect(
        assertManifestContract(candidate, { recipeId: RECIPE, role: 'logo' })
          .length > 0,
        label
      ).toBe(true);
    }
  });

  it('reports non-object tier entries instead of throwing', () => {
    const issues = assertManifestContract(
      { tiers: [null, 'nope', 42] },
      { recipeId: RECIPE, role: 'logo' }
    );
    expect(issues.join('; ')).toMatch(/not an object/);
    expect(issues.join('; ')).toMatch(/ladder/);
  });

  it('matches the route datetime rule exactly (minutes ok, basic offset out)', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    const minute = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00+01:00',
    };
    expect(
      assertManifestContract(minute, { recipeId: RECIPE, role: 'logo' })
    ).toEqual([]);
    const basic = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00:00+0100',
    };
    expect(
      assertManifestContract(basic, {
        recipeId: RECIPE,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
    const impossible = {
      ...corpus.validManifest,
      createdAt: '2026-02-30T20:00:00Z',
    };
    expect(
      assertManifestContract(impossible, {
        recipeId: RECIPE,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
  });

  it('rejects the review-2 quality-zero mutation exactly', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    const issues = assertManifestContract(corpus.invalidManifests.qualityZero, {
      recipeId: RECIPE,
      role: 'logo',
    });
    expect(issues.join('; ')).toMatch(/quality/);
  });
});
