import { describe, expect, it } from 'vitest';
import { piggyvestPostgresExecutionSchemas as schemas } from './piggyvest-postgres-execution';

describe('piggyvestPostgresExecutionSchemas', () => {
  it('accepts bounded primitive parameters and byte arrays without coercion', () => {
    expect(
      schemas.parameters.safeParse([
        'synthetic',
        null,
        1,
        new Uint8Array(65536),
      ]).success
    ).toBe(true);
  });
  it.each([
    [new Uint8Array(65537)],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER + 1],
    ['nul\0byte'],
    ['x'.repeat(65537)],
    ['\ud800'],
    [{}],
    [undefined],
    [true],
    Array(12).fill(null),
    [{ toPostgres: () => 'do not call' }],
  ])('rejects unsafe parameter types and sizes', (...parameters) => {
    expect(schemas.parameters.safeParse(parameters).success).toBe(false);
  });
  it('bounds result rows and rejects non-SELECT commands', () => {
    expect(
      schemas.result.safeParse({ rows: [], command: 'SELECT' }).success
    ).toBe(true);
    expect(
      schemas.result.safeParse({ rows: Array(101).fill({}), command: 'SELECT' })
        .success
    ).toBe(false);
    expect(
      schemas.result.safeParse({ rows: [], command: 'UPDATE' }).success
    ).toBe(false);
  });
  it('rejects missing or ambiguous session identity', () => {
    expect(schemas.session.safeParse([]).success).toBe(false);
    expect(schemas.session.safeParse([{}]).success).toBe(false);
    expect(schemas.session.safeParse([{}, {}]).success).toBe(false);
  });
});
