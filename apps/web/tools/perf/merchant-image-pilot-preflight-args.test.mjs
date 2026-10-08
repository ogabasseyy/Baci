import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  parsePreflightArgs,
  parseStoreMap,
} from './merchant-image-pilot-preflight-args.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('preflight args', () => {
  it('requires the offline roots and pins the recipe by default', () => {
    expect(() => parsePreflightArgs(['--inventory', 'inv.json'])).toThrow(
      /acceptances.*required|missing required/i
    );
    // The sample pin is mandatory: omitting --expect-sample aborts the
    // parse instead of running an unpinned gate.
    expect(() =>
      parsePreflightArgs([
        '--inventory',
        'inv.json',
        '--acceptances',
        'acc.json',
        '--input-root',
        'in',
        '--output-root',
        'out',
        '--public-dir',
        'pub',
      ])
    ).toThrow(/missing required flag --expect-sample/);
    const parsed = parsePreflightArgs([
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
      '--expect-sample',
      'sample.json',
      '--origin',
      'http://localhost:3000',
    ]);
    expect(parsed).toMatchObject({
      acceptances: 'acc.json',
      expectSample: 'sample.json',
      inventory: 'inv.json',
      origin: 'http://localhost:3000',
      recipe: RECIPE_ID,
      writeMounts: null,
    });
    const explicit = parsePreflightArgs([
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
      '--recipe',
      'pilot/other',
      '--write-mounts',
      'mounts.json',
      '--expect-sample',
      'sample.json',
    ]);
    expect(explicit.recipe).toBe('pilot/other');
    expect(explicit.writeMounts).toBe('mounts.json');
    expect(explicit.expectSample).toBe('sample.json');
  });

  it('rejects unknown and duplicate flags instead of degrading silently', () => {
    const base = [
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
    ];
    // The motivating typo: --orgin must abort, never null the origin and
    // skip every served check behind an offline-only ok:true.
    expect(() => parsePreflightArgs([...base, '--orgin', 'http://x'])).toThrow(
      /unknown preflight flag "--orgin"/
    );
    expect(() =>
      parsePreflightArgs([...base, '--inventory', 'other.json'])
    ).toThrow(/duplicate preflight flag "--inventory"/);
  });

  it('defaults the fetch timeout and rejects non-positive values', () => {
    const base = [
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
      '--expect-sample',
      'sample.json',
    ];
    expect(parsePreflightArgs(base).timeoutMs).toBe(10_000);
    expect(
      parsePreflightArgs([...base, '--timeout-ms', '1500']).timeoutMs
    ).toBe(1500);
    for (const bad of ['soon', '0', '-5', '1.5']) {
      expect(() => parsePreflightArgs([...base, '--timeout-ms', bad])).toThrow(
        /positive integer/
      );
    }
  });

  it('parses and validates the merchant-to-slug store map', () => {
    expect(parseStoreMap(`${MERCHANT}=ogabassey`)).toEqual({
      [MERCHANT]: 'ogabassey',
    });
    expect(parseStoreMap(null)).toEqual({});
    expect(() => parseStoreMap('no-equals')).toThrow(/merchantId=slug/);
    expect(() => parseStoreMap('nope=slug')).toThrow(/not a UUID/);
    expect(() => parseStoreMap(`${MERCHANT}=Bad_Slug`)).toThrow(/slug/);
  });
});
