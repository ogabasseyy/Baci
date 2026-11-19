import { describe, expect, it } from 'vitest';
import {
  canonicalSearch,
  partitionSensitiveSearch,
} from './sensitive-url-params';

describe('bugfix: the query delimiter was stripped twice', () => {
  it('keeps a public parameter whose name starts with a question mark', () => {
    expect(partitionSensitiveSearch('??view=details&token=A')).toEqual({
      privateEntries: [['token', 'A']],
      publicSearch: '%3Fview=details',
    });
  });

  it('keeps that parameter in the canonical form too', () => {
    expect(canonicalSearch('??view=details')).toBe('%3Fview=details');
  });

  it('still drops the single leading delimiter of an ordinary query', () => {
    expect(partitionSensitiveSearch('?a=1&email=x%40y.z').publicSearch).toBe(
      'a=1'
    );
    expect(canonicalSearch('?b=2&a=1')).toBe('a=1&b=2');
  });
});
