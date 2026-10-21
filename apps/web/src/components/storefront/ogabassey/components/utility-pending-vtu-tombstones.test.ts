import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearForgottenVtuScopes,
  forgottenScopedKeys,
  listForgottenVtuScopes,
  noteForgottenVtuScope,
} from './utility-pending-vtu-tombstones';

describe('utility-pending-vtu-tombstones', () => {
  beforeEach(() => {
    clearForgottenVtuScopes();
  });

  it('accumulates different generations and refreshes same-key records', () => {
    noteForgottenVtuScope('s-1', 1000, 'key-loser');
    noteForgottenVtuScope('s-1', 1005, 'key-winner');
    noteForgottenVtuScope('s-1', 1003, 'key-loser');

    // Same-key refresh keeps the newest timestamp; cross-key
    // records coexist (CodeRabbit Major: single-slot replacement
    // dropped the loser and resurrected it on merge).
    expect(forgottenScopedKeys.get('s-1')).toEqual([
      { forgottenAt: 1003, key: 'key-loser' },
      { forgottenAt: 1005, key: 'key-winner' },
    ]);
  });

  it('lists every scope record flattened for serialization', () => {
    noteForgottenVtuScope('s-1', 1000, 'key-a');
    noteForgottenVtuScope('s-1', 1005, 'key-b');
    noteForgottenVtuScope('s-2', 1002);

    expect(listForgottenVtuScopes()).toEqual([
      { scoped: 's-1', forgottenAt: 1000, key: 'key-a' },
      { scoped: 's-1', forgottenAt: 1005, key: 'key-b' },
      { scoped: 's-2', forgottenAt: 1002 },
    ]);
  });

  it('clears every scope record', () => {
    noteForgottenVtuScope('s-1', 1000, 'key-a');
    clearForgottenVtuScopes();

    expect(forgottenScopedKeys.size).toBe(0);
  });
});
