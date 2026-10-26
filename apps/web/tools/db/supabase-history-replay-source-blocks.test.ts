import { describe, expect, it } from 'vitest';
import { combineReplaySourceBlocks } from './supabase-history-replay-source-blocks';

describe('combineReplaySourceBlocks', () => {
  it('orders rows by migration filename rather than hash or block order', () => {
    expect(
      combineReplaySourceBlocks([
        '\n aaa 20260201000000_second.sql\nccc 20260301000000_third.sql\n',
        'zzz 20260101000000_first.sql',
      ])
    ).toBe(
      'zzz 20260101000000_first.sql\naaa 20260201000000_second.sql\nccc 20260301000000_third.sql'
    );
  });

  it('preserves same-filename rows and duplicates for downstream validation', () => {
    expect(
      combineReplaySourceBlocks([
        'zzz 20260101000000_first.sql\naaa 20260101000000_first.sql',
        'zzz 20260101000000_first.sql',
      ])
    ).toBe(
      'zzz 20260101000000_first.sql\naaa 20260101000000_first.sql\nzzz 20260101000000_first.sql'
    );
  });

  it('preserves malformed rows for the manifest parser to reject', () => {
    expect(
      combineReplaySourceBlocks(['aaa 20260101000000_first.sql\nmalformed'])
    ).toBe('malformed\naaa 20260101000000_first.sql');
    expect(combineReplaySourceBlocks([])).toBe('');
  });
});
