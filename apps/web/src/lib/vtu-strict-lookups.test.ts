import { describe, expect, it } from 'vitest';
import { throwIfStrictVtuLookupError } from './vtu-strict-lookups';

describe('throwIfStrictVtuLookupError', () => {
  it('throws a 500-class error per context when strict and errored', () => {
    expect(() =>
      throwIfStrictVtuLookupError({
        context: 'resolve VTU merchant',
        error: { message: 'connection reset' },
        strictLookups: true,
      })
    ).toThrow('Failed to resolve VTU merchant: connection reset');
    expect(() =>
      throwIfStrictVtuLookupError({
        context: 'load VTU merchant settings',
        error: { message: 'timeout' },
        strictLookups: true,
      })
    ).toThrow('Failed to load VTU merchant settings: timeout');
    expect(() =>
      throwIfStrictVtuLookupError({
        context: 'look up VTU customer',
        error: { message: 'connection reset' },
        strictLookups: true,
      })
    ).toThrow('Failed to look up VTU customer: connection reset');
  });

  it('stays silent without strict mode or without an error', () => {
    expect(() =>
      throwIfStrictVtuLookupError({
        context: 'look up VTU customer',
        error: { message: 'connection reset' },
      })
    ).not.toThrow();
    expect(() =>
      throwIfStrictVtuLookupError({
        context: 'look up VTU customer',
        error: null,
        strictLookups: true,
      })
    ).not.toThrow();
  });
});
