import { expect, it } from 'vitest';
import { parseArgs } from './sitespeed-cli-options.mjs';

it('parses measurement selections and explicit numeric options', () => {
  expect(
    parseArgs([
      '--dry-run',
      '--profile',
      'mobile,desktop',
      '--family',
      'blog',
      '--samples',
      '3',
    ])
  ).toEqual({
    dryRun: true,
    profiles: ['mobile', 'desktop'],
    families: ['blog'],
    samples: 3,
  });
});

it('rejects unknown flags and missing values before starting measurements', () => {
  expect(() => parseArgs(['--unknown'])).toThrow('unknown option');
  expect(() => parseArgs(['--base-url'])).toThrow('missing value');
  expect(() => parseArgs(['--output', '--dry-run'])).toThrow('missing value');
});
