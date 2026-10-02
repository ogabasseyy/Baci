import { describe, expect, it } from 'vitest';
import { isPreviewPrerenderBuild } from './prerender-preview-cap';

describe('isPreviewPrerenderBuild', () => {
  it.each<[string | undefined, boolean]>([
    ['preview', true],
    ['production', false],
    ['development', false],
    ['test', false],
    ['Preview', false],
    ['', false],
    [undefined, false],
  ])('maps VERCEL_ENV=%j to %j', (vercelEnv, expected) => {
    expect(isPreviewPrerenderBuild({ vercelEnv })).toBe(expected);
  });

  it('reads the ambient environment by default', () => {
    // The ambient test runner never sets VERCEL_ENV=preview.
    expect(isPreviewPrerenderBuild()).toBe(false);
  });
});
