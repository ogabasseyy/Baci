import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { tierDispositionIssues } from './merchant-image-pilot-preflight-manifest-disposition.mjs';

const SOURCE = {
  bytes: 2000,
  format: 'png',
  orientedHeight: 100,
  orientedWidth: 200,
  sha256: 'a'.repeat(64),
};

describe('merchant-image-pilot-preflight-manifest-disposition', () => {
  it('accepts valid generated, over-source, and passthrough tiers', () => {
    const tiers = [
      {
        bytes: 1000,
        delivery: 'generated',
        format: 'avif',
        height: 48,
        requestedWidth: 96,
        width: 96,
      },
      {
        bytes: 3000,
        delivery: 'generated-over-source',
        format: 'webp',
        height: 48,
        requestedWidth: 96,
        width: 96,
      },
      {
        bytes: SOURCE.bytes,
        delivery: 'original-passthrough',
        format: SOURCE.format,
        height: SOURCE.orientedHeight,
        requestedWidth: 384,
        sha256: SOURCE.sha256,
        width: SOURCE.orientedWidth,
      },
    ];
    expect(
      tierDispositionIssues(tiers, {
        manifest: { recipeId: RECIPE_ID },
        role: 'logo',
        source: SOURCE,
      })
    ).toEqual([]);
  });

  it('flags ceiling, delivery omission, never-larger, passthrough, and geometry violations', () => {
    const issues = tierDispositionIssues(
      [
        {
          bytes: 999_999,
          delivery: 'generated',
          format: 'avif',
          height: 20,
          requestedWidth: 96,
          width: 80,
        },
        {
          bytes: 500,
          format: 'webp',
          height: 48,
          requestedWidth: 96,
          width: 96,
        },
        {
          bytes: 1000,
          delivery: 'generated-over-source',
          format: 'avif',
          height: 10,
          requestedWidth: 96,
          width: 96,
        },
        {
          bytes: 123,
          delivery: 'original-passthrough',
          format: 'png',
          height: 100,
          requestedWidth: 96,
          sha256: 'b'.repeat(64),
          width: 200,
        },
      ],
      {
        manifest: { recipeId: RECIPE_ID },
        role: 'logo',
        source: SOURCE,
      }
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/exceeds the recipe byte ceiling/),
        expect.stringMatching(/claims generated delivery above the source/),
        expect.stringMatching(/width 80 is not the encoded rung width 96/),
        expect.stringMatching(/omits delivery for the current recipe/),
        expect.stringMatching(/over-source limitation that does not hold/),
        expect.stringMatching(/breaks the source aspect ratio/),
        expect.stringMatching(/pass-through must reuse the validated source/),
      ])
    );
  });
});
