import { expect, it, vi } from 'vitest';

const save = vi.hoisted(() => vi.fn());
vi.mock('./cart-storage', async (original) => ({
  ...(await original<object>()),
  saveCartToStorage: save,
}));

import { persistSharedCartDisplay } from './persist-shared-cart-display';

it('does not file an old merchant or unresolved import under the new storage key', () => {
  const input = {
    enabled: true,
    merchantSlug: 'new',
    sessionGeneration: 2,
    generation: 1,
    importStatus: 'done' as const,
    display: [],
  };
  persistSharedCartDisplay(input);
  persistSharedCartDisplay({
    ...input,
    generation: 2,
    importStatus: 'pending',
  });
  expect(save).not.toHaveBeenCalled();
  persistSharedCartDisplay({ ...input, generation: 2 });
  expect(save).toHaveBeenCalledExactlyOnceWith([], 'new');
});
