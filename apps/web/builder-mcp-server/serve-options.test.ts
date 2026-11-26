import { expect, it } from 'vitest';
import { parseServeOptions } from './serve-options';

it('accepts the experience flag before or after a single port', () => {
  expect(parseServeOptions([])).toEqual({ port: 8790, experience: false });
  expect(parseServeOptions(['--experience', '8791'])).toEqual({
    port: 8791,
    experience: true,
  });
  expect(parseServeOptions(['8791', '--experience'])).toEqual({
    port: 8791,
    experience: true,
  });
});

it('rejects unknown flags, duplicate arguments, and invalid ports', () => {
  for (const args of [
    ['--extra'],
    ['1', '2'],
    ['--experience', '--experience'],
    ['0'],
    ['65536'],
    ['1.5'],
  ]) {
    expect(() => parseServeOptions(args)).toThrow();
  }
});
