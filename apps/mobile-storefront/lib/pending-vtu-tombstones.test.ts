import {
  clearForgottenVtuScopes,
  forgottenVtuScopes,
  listForgottenVtuTombstones,
  noteForgottenVtuScopes,
} from './pending-vtu-tombstones';

describe('pending-vtu-tombstones', () => {
  beforeEach(() => {
    clearForgottenVtuScopes();
  });

  it('accumulates different generations and refreshes same-key records', () => {
    noteForgottenVtuScopes(['s-1'], 1000, 'key-loser');
    noteForgottenVtuScopes(['s-1'], 1005, 'key-winner');
    noteForgottenVtuScopes(['s-1'], 1003, 'key-loser');

    // Same-key refresh keeps the newest timestamp; cross-key
    // records coexist (CodeRabbit Major: single-slot replacement
    // dropped the loser and resurrected it on merge).
    expect(forgottenVtuScopes.get('s-1')).toEqual([
      { forgottenAt: 1003, key: 'key-loser' },
      { forgottenAt: 1005, key: 'key-winner' },
    ]);
  });

  it('lists every scope record flattened for serialization', () => {
    noteForgottenVtuScopes(['s-1'], 1000, 'key-a');
    noteForgottenVtuScopes(['s-1'], 1005, 'key-b');
    noteForgottenVtuScopes(['s-2'], 1002);

    expect(listForgottenVtuTombstones()).toEqual([
      { scoped: 's-1', forgottenAt: 1000, key: 'key-a' },
      { scoped: 's-1', forgottenAt: 1005, key: 'key-b' },
      { scoped: 's-2', forgottenAt: 1002 },
    ]);
  });

  it('clears every scope record', () => {
    noteForgottenVtuScopes(['s-1'], 1000, 'key-a');
    clearForgottenVtuScopes();

    expect(forgottenVtuScopes.size).toBe(0);
  });
});
