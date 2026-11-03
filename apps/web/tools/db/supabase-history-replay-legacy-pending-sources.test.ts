import { describe, expect, it } from 'vitest';
import { replayRegistry } from './replay-registry';
import { LEGACY_PENDING_SOURCE_BLOCKS } from './supabase-history-replay-legacy-pending-sources';

// The frozen pre-registry blocks. Their exact combined output is pinned in
// replay-registry-baseline.test.ts; this guards each block's shape so a bad
// edit fails here with the block named, not as an opaque manifest parse error.
const FROZEN_ROW = /^[0-9a-f]{64} \d{14}_[a-z0-9_]+\.sql$/;
const rowsOf = (block: string) => block.trim().split('\n');

describe('frozen legacy pending replay blocks', () => {
  it('keeps the 45 pre-registry blocks', () => {
    expect(LEGACY_PENDING_SOURCE_BLOCKS).toHaveLength(45);
  });

  it('holds only well-formed, non-empty blocks', () => {
    for (const [index, block] of LEGACY_PENDING_SOURCE_BLOCKS.entries()) {
      expect(block.trim(), `block ${index} is empty`).not.toBe('');
      for (const row of rowsOf(block)) {
        expect(row, `block ${index} has a malformed row`).toMatch(FROZEN_ROW);
      }
    }
  });

  it('registers each migration in exactly one place', () => {
    const filenames = [
      ...LEGACY_PENDING_SOURCE_BLOCKS.flatMap(rowsOf),
      ...replayRegistry.readSourceRows('pending-sources.txt'),
    ].map((row) => row.slice(65));
    const repeated = filenames.filter(
      (filename, index) => filenames.indexOf(filename) !== index
    );

    expect(repeated).toEqual([]);
  });
});
