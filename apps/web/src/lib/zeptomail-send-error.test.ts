import { describe, expect, it } from 'vitest';
import { parseError } from './zeptomail-send-error';

describe('zeptomail-send-error', () => {
  it('parses provider, Error, and unknown failures', () => {
    expect(
      parseError({
        error: { code: 'TM_1001', message: 'bad', details: { a: 1 } },
      })
    ).toEqual({ message: 'bad', code: 'TM_1001', details: { a: 1 } });
    const coded = new Error('nope') as Error & { code: string };
    coded.code = 'E_CONN';
    expect(parseError(coded)).toEqual({ message: 'nope', code: 'E_CONN' });
    expect(parseError('flat')).toEqual({ message: 'flat' });
  });
});
