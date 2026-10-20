import { describe, expect, it } from 'vitest';
import { formatSupabaseErrorLog } from './supabase-error-log';

describe('formatSupabaseErrorLog', () => {
  it('keeps Error messages and stacks for runtime exceptions', () => {
    const error = new Error('database connection failed');
    error.stack = 'Error: database connection failed\n    at query';

    expect(formatSupabaseErrorLog(error)).toEqual({
      message: 'database connection failed',
      stack: 'Error: database connection failed\n    at query',
      name: 'Error',
    });
  });

  it('extracts Supabase error object fields instead of logging Unknown error', () => {
    expect(
      formatSupabaseErrorLog({
        message: 'canceling statement due to statement timeout',
        code: '57014',
        details: 'Query timed out while scanning products',
        hint: 'Add an index',
      })
    ).toEqual({
      message: 'canceling statement due to statement timeout',
      code: '57014',
      details: 'Query timed out while scanning products',
      hint: 'Add an index',
      thrownValueType: 'Object',
    });
  });

  it('records primitive thrown values without dropping string messages', () => {
    expect(formatSupabaseErrorLog('query aborted')).toEqual({
      message: 'query aborted',
      thrownValueType: 'string',
    });
  });

  it('handles Error subclasses as regular runtime exceptions', () => {
    expect(formatSupabaseErrorLog(new TypeError('bad product row'))).toEqual(
      expect.objectContaining({
        message: 'bad product row',
        name: 'TypeError',
      })
    );
  });

  it('falls back safely for non-message objects and non-string primitives', () => {
    expect(formatSupabaseErrorLog({ code: 'PGRST000' })).toEqual({
      message: 'Unknown error',
      code: 'PGRST000',
      thrownValueType: 'Object',
    });
    expect(
      formatSupabaseErrorLog({ message: '', hint: 'Retry later' })
    ).toEqual({
      message: 'Unknown error',
      hint: 'Retry later',
      thrownValueType: 'Object',
    });
    expect(formatSupabaseErrorLog(503)).toEqual({
      message: 'Unknown error',
      thrownValueType: 'number',
    });
    expect(formatSupabaseErrorLog(false)).toEqual({
      message: 'Unknown error',
      thrownValueType: 'boolean',
    });
    expect(formatSupabaseErrorLog(undefined)).toEqual({
      message: 'Unknown error',
      thrownValueType: 'undefined',
    });
    expect(formatSupabaseErrorLog(null)).toEqual({
      message: 'Unknown error',
      thrownValueType: 'null',
    });
  });
});
