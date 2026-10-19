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
      // Structural agreement: check each manifest against its own recipe
      // so the currency rule does not mask the structural rules (the
      // frozen r1 pair is structurally valid but not current).
      expect(
        assertManifestContract(corpus[label], {
          recipeId: corpus[label].recipeId,
          role: 'logo',
        }),
        label
      ).toEqual([]);
    }
    for (const [label, candidate] of Object.entries(corpus.invalidManifests)) {
      expect(
        assertManifestContract(candidate, {
          recipeId: candidate.recipeId,
          role: 'logo',
        }).length > 0,
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
    const selfRecipe = corpus.validManifest.recipeId;
    const minute = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00+01:00',
    };
    expect(
      assertManifestContract(minute, { recipeId: selfRecipe, role: 'logo' })
    ).toEqual([]);
    const basic = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00:00+0100',
    };
    expect(
      assertManifestContract(basic, {
        recipeId: selfRecipe,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
    const impossible = {
      ...corpus.validManifest,
      createdAt: '2026-02-30T20:00:00Z',
    };
    expect(
      assertManifestContract(impossible, {
        recipeId: selfRecipe,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
  });

  it('rejects the review-2 quality-zero mutation exactly', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    const candidate = corpus.invalidManifests.qualityZero;
    const issues = assertManifestContract(candidate, {
      recipeId: candidate.recipeId,
      role: 'logo',
    });
    expect(issues.join('; ')).toMatch(/quality/);
  });
});
