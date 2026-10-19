import { describe, expect, it, vi } from 'vitest';
import { createExpenseMenuItem } from './expense-menu-item';

describe('createExpenseMenuItem', () => {
  it('returns the Expenses menu item for callers with view access', () => {
    const onPress = vi.fn();

    expect(createExpenseMenuItem(true, onPress)).toEqual({
      description: 'Track spending and receipts',
      icon: 'wallet-outline',
      id: 'expenses',
      label: 'Expenses',
      onPress,
    });
  });

  it('returns null instead of a hidden menu item without view access', () => {
    expect(createExpenseMenuItem(false, vi.fn())).toBeNull();
  });

  it('routes create-only staff directly to the add screen', () => {
    const onPress = vi.fn();
    const onCreatePress = vi.fn();
    const item = createExpenseMenuItem(false, onPress, true, onCreatePress);
    expect(item?.onPress).toBe(onCreatePress);
  });
});
