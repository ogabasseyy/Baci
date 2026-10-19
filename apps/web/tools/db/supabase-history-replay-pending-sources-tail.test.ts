import { describe, expect, it } from 'vitest';
import { PENDING_SOURCES_HEAD_TAIL } from './supabase-history-replay-pending-sources-tail';

/**
 * Colocated guard for the R126 tail split: the tail block is
 * interpolated verbatim into PENDING_SOURCES_HEAD, whose rows the
 * replay verifier hashes against disk. This test fails fast — with a
 * readable message — if an edit breaks the row shape, ordering, or
 * uniqueness, rather than surfacing as an opaque hash mismatch in
 * the far slower replay suite.
 */
const FROZEN_ROW = /^[0-9a-f]{64} 202\d{11}_[a-z0-9_]+\.sql$/;

function rows(): string[] {
  return PENDING_SOURCES_HEAD_TAIL.trim().split('\n');
}

describe('supabase-history-replay-pending-sources-tail', () => {
  it('holds well-formed frozen rows (Codex R145 P1)', () => {
    const lines = rows();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(FROZEN_ROW);
    }
  });

  it('lists migrations in strictly increasing version order without duplicates (Codex R145 P1)', () => {
    const names = rows().map((line) => line.split(' ')[1] as string);
    const versions = names.map((name) => name.slice(0, 14));
    expect(new Set(names).size).toBe(names.length);
    expect([...versions].sort()).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('ends with a trailing newline so interpolation never fuses rows (Codex R145 P1)', () => {
    expect(PENDING_SOURCES_HEAD_TAIL.endsWith('\n')).toBe(true);
    expect(PENDING_SOURCES_HEAD_TAIL.trim()).not.toContain('\n\n');
  });
});
