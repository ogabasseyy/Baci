import { describe, expect, it } from 'vitest';
import { parseJumiaOrderQuery } from './parse-jumia-order-query';

describe('parseJumiaOrderQuery', () => {
  it('applies bounded defaults', () => {
    expect(parseJumiaOrderQuery(new URLSearchParams())).toEqual({
      success: true,
      data: { limit: 50, offset: 0 },
    });
  });

  it('rejects invalid pagination values before querying', () => {
    expect(parseJumiaOrderQuery(new URLSearchParams('limit=0'))).toMatchObject({
      success: false,
    });
  });
});
