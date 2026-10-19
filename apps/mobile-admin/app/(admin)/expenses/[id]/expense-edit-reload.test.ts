import { describe, expect, it } from 'vitest';
import { shouldResetExpenseEditDraftOnReload } from './expense-edit-reload';

describe('shouldResetExpenseEditDraftOnReload', () => {
  it('resets the draft only after a successful reload', () => {
    expect(
      shouldResetExpenseEditDraftOnReload({
        isSuccess: true,
        data: { id: 'expense-id' },
      })
    ).toBe(true);
  });

  it('keeps the draft when a refetch fails with stale cached data', () => {
    expect(
      shouldResetExpenseEditDraftOnReload({
        isSuccess: false,
        data: { id: 'expense-id' },
      })
    ).toBe(false);
  });
});
