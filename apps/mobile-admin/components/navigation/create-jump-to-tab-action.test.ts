import { describe, expect, it } from 'vitest';
import { createJumpToTabAction } from './create-jump-to-tab-action';

describe('createJumpToTabAction', () => {
  it('builds a JUMP_TO action with route name and params', () => {
    expect(createJumpToTabAction('orders', { status: 'open' })).toEqual({
      payload: { name: 'orders', params: { status: 'open' } },
      type: 'JUMP_TO',
    });
  });
});
