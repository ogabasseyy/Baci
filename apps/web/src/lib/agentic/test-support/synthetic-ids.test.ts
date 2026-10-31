// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { syntheticUuid } from './synthetic-ids';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('syntheticUuid', () => {
  it('writes the namespace and index as zero-padded hex in a version 4 shape', () => {
    expect(syntheticUuid(0xa, 0)).toBe('0000000a-0000-4000-8000-000000000000');
    expect(syntheticUuid(0xb, 111)).toBe(
      '0000000b-0000-4000-8000-00000000006f'
    );
    expect(syntheticUuid(0xc, 2)).toMatch(UUID_V4);
  });

  it('returns the same id for the same inputs', () => {
    expect(syntheticUuid(0xa, 100)).toBe(syntheticUuid(0xa, 100));
  });

  it('gives each namespace and index its own id', () => {
    const ids = [0xa, 0xb, 0xc].flatMap((namespace) =>
      [0, 1, 100, 101, 110].map((index) => syntheticUuid(namespace, index))
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
