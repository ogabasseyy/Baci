import { describe, expect, it } from 'vitest';
import { mergePendingReplaySourceRows } from './merge-pending-replay-source-rows';

const row = (hashCharacter: string, filename: string) =>
  `${hashCharacter.repeat(64)} ${filename}`;

describe('mergePendingReplaySourceRows', () => {
  it('orders rows by migration filename in code-unit order', () => {
    // localeCompare would put `_c` before `1`; code units put `1` (0x31)
    // before `_` (0x5f). Both inventories must agree on one rule.
    expect(
      mergePendingReplaySourceRows(
        [row('a', '20261101000000_ab_c.sql')],
        [row('b', '20261101000000_ab1.sql'), row('c', '20261031000000_z.sql')]
      )
    ).toEqual([
      row('c', '20261031000000_z.sql'),
      row('b', '20261101000000_ab1.sql'),
      row('a', '20261101000000_ab_c.sql'),
    ]);
  });

  it('collapses an identical duplicate inside the frozen legacy set', () => {
    expect(
      mergePendingReplaySourceRows(
        [row('a', '20261101000000_a.sql'), row('a', '20261101000000_a.sql')],
        []
      )
    ).toEqual([row('a', '20261101000000_a.sql')]);
  });

  it('rejects one legacy migration registered with two hashes', () => {
    expect(() =>
      mergePendingReplaySourceRows(
        [row('a', '20261101000000_a.sql'), row('b', '20261101000000_a.sql')],
        []
      )
    ).toThrow('20261101000000_a.sql is registered with two different hashes');
  });

  it.each([
    ['the same hash', 'a'],
    ['a different hash', 'b'],
  ])('rejects a registry row that re-registers a legacy migration with %s', (_case, hash) => {
    expect(() =>
      mergePendingReplaySourceRows(
        [row('a', '20261101000000_a.sql')],
        [row(hash, '20261101000000_a.sql')]
      )
    ).toThrow(
      'Replay registry: 20261101000000_a.sql is already registered in the frozen legacy set; remove it from the registry folder'
    );
  });

  it('rejects a malformed legacy row', () => {
    expect(() => mergePendingReplaySourceRows(['not a row'], [])).toThrow(
      'Invalid frozen pending replay row: not a row'
    );
  });
});
