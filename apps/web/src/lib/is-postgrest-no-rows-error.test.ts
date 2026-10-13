import { describe, expect, it } from 'vitest';
import { isPostgrestNoRowsError } from './is-postgrest-no-rows-error';

describe('isPostgrestNoRowsError', () => {
  it('recognizes only PostgREST no-row errors as an expected absence', () => {
    expect(isPostgrestNoRowsError({ code: 'PGRST116' })).toBe(true);
    expect(isPostgrestNoRowsError({ code: '57014' })).toBe(false);
    expect(isPostgrestNoRowsError(null)).toBe(false);
  });
});
