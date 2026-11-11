import { describe, expect, it } from 'vitest';
import { parseOperatorArgs, UsageError } from './parse-args';

const CAPTURE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('parseOperatorArgs', () => {
  it('shows help with no command', () => {
    expect(parseOperatorArgs([])).toEqual({ kind: 'help' });
    expect(parseOperatorArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('lists 50 by default and accepts a bounded limit', () => {
    expect(parseOperatorArgs(['list'])).toEqual({
      kind: 'list',
      limit: 50,
      offset: 0,
    });
    expect(parseOperatorArgs(['list', '--limit', '7'])).toEqual({
      kind: 'list',
      limit: 7,
      offset: 0,
    });
  });

  it('pages past the first 200 with --offset', () => {
    expect(
      parseOperatorArgs(['list', '--limit', '200', '--offset', '400'])
    ).toEqual({ kind: 'list', limit: 200, offset: 400 });
    expect(() => parseOperatorArgs(['list', '--offset', '-1'])).toThrow(
      UsageError
    );
  });

  it.each([['0'], ['201'], ['abc']])('refuses limit %s', (limit) => {
    expect(() => parseOperatorArgs(['list', '--limit', limit])).toThrow(
      UsageError
    );
  });

  it('parses a confirmed requeue and trims the reason', () => {
    expect(
      parseOperatorArgs([
        'requeue',
        CAPTURE,
        '--reason',
        '  fix #4199 deployed  ',
        '--yes',
      ])
    ).toEqual({
      kind: 'requeue',
      captureId: CAPTURE,
      reason: 'fix #4199 deployed',
      confirmed: true,
    });
  });

  it('accepts any id PostgreSQL prints as a uuid, not only RFC-versioned ones', () => {
    const nonRfc = 'ffffffff-ffff-0fff-cfff-ffffffffffff';
    expect(
      parseOperatorArgs(['requeue', nonRfc, '--reason', 'fix #4199 deployed'])
    ).toMatchObject({ captureId: nonRfc });
  });

  it('defaults to a preview without --yes', () => {
    expect(
      parseOperatorArgs(['requeue', CAPTURE, '--reason', 'fix #4199 deployed'])
    ).toMatchObject({ confirmed: false });
  });

  it.each([
    [['requeue']],
    [['requeue', 'not-a-uuid', '--reason', 'fix #4199 deployed']],
    [['requeue', CAPTURE]],
    [['requeue', CAPTURE, '--reason', 'short']],
    [['requeue', CAPTURE, '--reason']],
    [['requeue', CAPTURE, '--reason', 'fix #4199 deployed', '--force']],
    [['delete', CAPTURE]],
  ])('refuses %j', (argv) => {
    expect(() => parseOperatorArgs(argv)).toThrow(UsageError);
  });
});
