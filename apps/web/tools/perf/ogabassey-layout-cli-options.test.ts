import { expect, it, vi } from 'vitest';
import { readFlag, readFlags } from './ogabassey-layout-cli-options';

it('reads repeated arguments and rejects a missing value', () => {
  vi.stubGlobal('process', {
    ...process,
    argv: [
      'node',
      'script',
      '--name',
      'a',
      '--name',
      'b',
      '--missing',
      '--other',
    ],
  });
  try {
    expect(readFlags('--name')).toEqual(['a', 'b']);
    expect(readFlag('--name')).toBe('a');
    expect(() => readFlag('--missing')).toThrow(/missing --missing/i);
  } finally {
    vi.unstubAllGlobals();
  }
});
